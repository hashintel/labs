import { dirname, resolve } from "node:path";
import type { IntegrationYaml } from "./schema.js";
import { buildConnectorDef, buildPipelines, buildLinkPipelines } from "./build.js";
import { integrationId, statePaths } from "./identity.js";
import type { RetryPolicy, StepContext } from "./orchestrator.js";
import { type SourceResult, sourceResultFromSync, failedSourceResult, assertSyncProgress } from "./result.js";
import { integrate, type IntegrationSpec } from "@integrations/engine.js";
import { createMemoryEventStore } from "@integrations/staging/memory.js";
import { createDuckDbQueryStore } from "@integrations/staging/duckdb.js";
import { createLocalStorage } from "@integrations/storage/local.js";
import { createGraphClient, type GraphLimiter } from "@integrations/graph/client.js";
import { createStubGraphClient } from "@integrations/graph/stub.js";
import type { GraphClient } from "@integrations/graph/types.js";
import type { Step, TransformFn } from "@integrations/transform/pipeline.js";
import type { LogLevel } from "@integrations/log.js";

/**
 * Everything a sync needs, as plain JSON: the workflow function is statically
 * registered and any orchestrator process can execute it (DBOS dequeues have no
 * enqueuer affinity), so live resources (DuckDB store, graph client) are built
 * INSIDE the workflow from this input, never closed over. Env is resolved
 * enqueuer-side (secrets belong to the user's environment); the `runtime` block
 * carries what the executing process must know.
 */
export type SyncInput = {
  yaml: IntegrationYaml;
  runId: string;
  linksOnly: boolean;
  logLevel: LogLevel;
  transformsPath?: string;
  retry: RetryPolicy;
  runtime: {
    webId: string;
    actorId?: string;
    graphUrl?: string;
    baseDir: string;
    duckdb: {
      sandboxOff: boolean;
      sourceFolder?: string;
      allowedExtraDirs: string[];
      memoryLimit?: string;
      maxTempDirectorySize?: string;
      threads?: number;
    };
  };
  limits: {
    /** THE default target: shared write budget (ops/sec) applied to every web. */
    webOpsPerSec?: number;
    /** Per-web override of the default rate for this run's web (else the default applies). */
    opsPerSecOverride?: number;
  };
};

/** Provided by the backend on the executing process; never serialized. */
export type WorkflowDeps = {
  limiter?: GraphLimiter;
};

function hasGraphSinkDeep(steps: readonly Step[]): boolean {
  return steps.some((s) => {
    if (s.kind === "graph-sink") return true;
    if (s.kind === "branch") return s.branches.some((b) => hasGraphSinkDeep(b as Step[]));
    return false;
  });
}

async function loadTransforms(path: string): Promise<Record<string, TransformFn>> {
  const mod = await import(resolve(path)) as Record<string, unknown>;
  const out: Record<string, TransformFn> = {};
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn === "function") out[name] = fn as TransformFn;
  }
  return out;
}

export async function runSync(input: SyncInput, ctx: StepContext, deps: WorkflowDeps = {}): Promise<SourceResult[]> {
  const { yaml, runtime } = input;
  const id = integrationId(yaml, runtime.webId);
  const paths = statePaths(runtime.baseDir, id);

  const connectorDef = buildConnectorDef(yaml);
  const tablePipelines = buildPipelines(yaml);
  const linkPipelines = buildLinkPipelines(yaml, runtime.webId);
  const needsGraph = tablePipelines.some((tp) => hasGraphSinkDeep(tp.pipeline.steps)) || linkPipelines.length > 0;

  let graphClient: GraphClient | undefined;
  if (needsGraph) {
    if (runtime.graphUrl && runtime.actorId) {
      graphClient = createGraphClient({ baseUrl: runtime.graphUrl, actorId: runtime.actorId, limiter: deps.limiter });
    } else {
      console.log("[graph] stub (set HASH_GRAPH_URL + HASH_ACTOR_ID for real graph)");
      graphClient = createStubGraphClient();
    }
  }

  // DuckDB sandbox: SQL may only touch the state dir (db file + staging), the
  // source folder, and any explicitly allowed extras. sandboxOff opts out
  // (required for attach sources, which the sandbox blocks).
  const allowedDirectories = runtime.duckdb.sandboxOff ? undefined : [
    dirname(resolve(paths.duckdb)),
    resolve(paths.staging),
    ...(runtime.duckdb.sourceFolder ? [resolve(runtime.duckdb.sourceFolder)] : []),
    ...runtime.duckdb.allowedExtraDirs.map((d) => resolve(d)),
  ];
  const extensions = [...new Set(Object.values(yaml.sources ?? {}).flatMap((s) => (s.kind === "sql" ? s.extensions ?? [] : [])))];

  const queryStore = await createDuckDbQueryStore({
    path: paths.duckdb,
    allowedDirectories,
    extensions,
    memoryLimit: runtime.duckdb.memoryLimit,
    maxTempDirectorySize: runtime.duckdb.maxTempDirectorySize,
    threads: runtime.duckdb.threads,
  });

  const transforms = input.transformsPath ? await loadTransforms(input.transformsPath) : undefined;

  const spec: IntegrationSpec = {
    connector: connectorDef,
    pipelines: tablePipelines,
    linkPipelines,
    eventStore: createMemoryEventStore(),
    queryStore,
    storage: createLocalStorage({ root: paths.staging }),
    graphClient,
    transforms,
    logLevel: input.logLevel,
  };

  const app = integrate(spec);
  console.log(`[runner] ${id.canonical} (${id.configHash}): ${tablePipelines.length} pipelines, db=${paths.duckdb}`);

  // Close on interrupt so DuckDB checkpoints its WAL; registered on the process
  // actually executing the sync (which under DBOS may not be the enqueuer).
  const onSignal = () => {
    try { queryStore.close(); } catch { /* already closed */ }
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const linksOnly = input.linksOnly;

  const syncSource = async (source: string): Promise<SourceResult> => {
    const start = Date.now();
    const sync = await app.syncSources([source], { deferGraphLinks: true, skipEntities: linksOnly });
    assertSyncProgress(`sync:${source}`, sync);
    return sourceResultFromSync(source, sync, Date.now() - start);
  };

  const flushLinks = async (): Promise<SourceResult> => {
    const start = Date.now();
    const sync = await app.flushGraphLinks();
    // A flush makes no inserts of its own, so only abort counts as failure.
    assertSyncProgress("flush-links", sync, { requireProgress: false });
    return sourceResultFromSync("flush-links", sync, Date.now() - start);
  };

  try {
    const results: SourceResult[] = [];
    if (!linksOnly) {
      for (const source of app.getSourceOrder()) {
        try {
          results.push(await ctx.run(`sync:${source}`, () => syncSource(source)));
        } catch (err) {
          results.push(failedSourceResult(source, `retries exhausted: ${err instanceof Error ? err.message : String(err)}`));
        }
      }
    }
    if (needsGraph) {
      try {
        results.push(await ctx.run("flush-links", flushLinks));
      } catch (err) {
        results.push(failedSourceResult("flush-links", `retries exhausted: ${err instanceof Error ? err.message : String(err)}`));
      }
    }

    // Fail the workflow if any step exhausted retries, so the job isn't recorded as successful.
    const exhausted = results.filter((r) => r.status === "retries_exhausted");
    if (exhausted.length > 0) {
      for (const r of results) {
        console.error(`[workflow] ${r.source}: ${r.status} (${r.inserts + r.updates} ok, ${r.errors.length} errors)`);
      }
      throw new Error(
        `integration failed: ${exhausted.length}/${results.length} step(s) exhausted retries -- ` +
        exhausted.map((r) => `${r.source}: ${r.errors[0]?.message ?? "unknown"}`).join(" | "),
      );
    }
    return results;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    queryStore.close();
  }
}

/**
 * Budget scope is always the web: every run throttles against a bucket shared by all
 * of its web's runs. A per-web override sets that web's rate; otherwise the default
 * web rate applies. No rate configured = unthrottled.
 */
export function budgetScope(input: SyncInput): { scope: string; opsPerSec: number } | undefined {
  const opsPerSec = input.limits.opsPerSecOverride ?? input.limits.webOpsPerSec;
  if (!opsPerSec) return undefined;
  return { scope: input.runtime.webId, opsPerSec };
}
