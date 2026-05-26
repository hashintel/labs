import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { resolveEnvVars, type IntegrationYaml } from "./schema.js";
import { validateYaml } from "./validate.js";
import { buildConnectorDef, buildPipelines } from "./build.js";
import { loadConfig, type RunnerConfig } from "./config.js";
import { integrationId, statePaths } from "./identity.js";
import { workflowId } from "./config.js";
import { createBackend, retryPolicyFrom, type WorkflowFn } from "./orchestrator.js";
import { type WorkflowResult, type SourceResult, sourceResultFromSync, failedSourceResult, buildWorkflowResult } from "./result.js";
import { integrate, type IntegrationSpec } from "@integrations/engine.js";
import { createMemoryEventStore } from "@integrations/staging/memory.js";
import { createDuckDbQueryStore } from "@integrations/staging/duckdb.js";
import { createLocalStorage } from "@integrations/storage/local.js";
import { createGraphClient } from "@integrations/graph/client.js";
import { createStubGraphClient } from "@integrations/graph/stub.js";
import type { GraphClient } from "@integrations/graph/types.js";
import type { Step, TransformFn } from "@integrations/transform/pipeline.js";
import type { LogLevel } from "@integrations/log.js";

export type RunOpts = {
  yaml: IntegrationYaml;
  config: RunnerConfig;
  transforms?: Record<string, TransformFn>;
  logLevel?: LogLevel;
};

function hasGraphSinkDeep(steps: readonly Step[]): boolean {
  return steps.some((s) => {
    if (s.kind === "graph-sink") return true;
    if (s.kind === "branch") return s.branches.some((b) => hasGraphSinkDeep(b as Step[]));
    return false;
  });
}

export async function run(opts: RunOpts): Promise<WorkflowResult> {
  const { yaml, config, transforms } = opts;
  const logLevel = opts.logLevel ?? "info";

  const id = integrationId(yaml, config.webId);
  const paths = statePaths(config.baseDir, id);

  const connectorDef = buildConnectorDef(yaml);
  const tablePipelines = buildPipelines(yaml);
  const needsGraph = tablePipelines.some((tp) => hasGraphSinkDeep(tp.pipeline.steps));

  let graphClient: GraphClient | undefined;
  if (needsGraph) {
    if (config.graphUrl && config.actorId) {
      graphClient = createGraphClient({ baseUrl: config.graphUrl, actorId: config.actorId });
    } else {
      console.log("[graph] stub (set HASH_GRAPH_URL + HASH_ACTOR_ID for real graph)");
      graphClient = createStubGraphClient();
    }
  }

  const queryStore = await createDuckDbQueryStore(paths.duckdb);

  const spec: IntegrationSpec = {
    connector: connectorDef,
    pipelines: tablePipelines,
    eventStore: createMemoryEventStore(),
    queryStore,
    storage: createLocalStorage({ root: paths.staging }),
    graphClient,
    transforms,
    logLevel,
  };

  const app = integrate(spec);

  const backendKind = config.dbosUrl ? "dbos" : "direct";
  console.log(`[runner] ${id.canonical} (${id.configHash}): ${tablePipelines.length} pipelines, db=${paths.duckdb}, backend=${backendKind}`);

  const cleanup = () => { queryStore.close(); };

  const syncSource = async (source: string): Promise<SourceResult> => {
    const start = Date.now();
    const sync = await app.syncSources([source]);
    return sourceResultFromSync(source, sync, Date.now() - start);
  };

  const sources = app.getSourceOrder();
  const syncWorkflow: WorkflowFn<SourceResult[]> = async (ctx) => {
    const results: SourceResult[] = [];
    for (const source of sources) {
      try {
        results.push(await ctx.run(`sync:${source}`, () => syncSource(source)));
      } catch (err) {
        results.push(failedSourceResult(source, `retries exhausted: ${err instanceof Error ? err.message : String(err)}`));
      }
    }
    return results;
  };

  const retry = retryPolicyFrom(yaml.orchestration);
  const backend = await createBackend(
    config.dbosUrl
      ? { kind: "dbos", databaseUrl: config.dbosUrl, retry }
      : { kind: "direct", retry },
  );

  const startedAt = new Date().toISOString();
  try {
    const results = await backend.invoke(workflowId(id, config.runId), syncWorkflow);
    return buildWorkflowResult(id.canonical, id.configHash, results, startedAt);
  } finally {
    await backend.shutdown();
    cleanup();
  }
}

async function loadTransforms(path: string): Promise<Record<string, TransformFn>> {
  const abs = resolve(path);
  const mod = await import(abs) as Record<string, unknown>;
  const out: Record<string, TransformFn> = {};
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn === "function") out[name] = fn as TransformFn;
  }
  return out;
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");

  const args = process.argv.slice(2);
  const yamlPath = args.find((a) => !a.startsWith("--"));
  const transformsArg = args.find((a) => a.startsWith("--transforms="))?.split("=")[1];

  if (!yamlPath) {
    console.error("Usage: tsx src/runner.ts <integration.yaml> [--transforms=path/to/transforms.ts]");
    process.exit(1);
  }

  const raw = parseYaml(readFileSync(yamlPath, "utf8"));
  const yaml: IntegrationYaml = resolveEnvVars(raw);

  const errors = validateYaml(yaml);
  if (errors.length > 0) {
    console.error(`[validate] ${errors.length} error(s) in ${yamlPath}:`);
    for (const e of errors) console.error(`  ${e.path}: ${e.message}`);
    process.exit(1);
  }

  const config = loadConfig();
  const transforms = transformsArg ? await loadTransforms(transformsArg) : undefined;

  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));

  const result = await run({ yaml, config, transforms, logLevel: (process.env.LOG_LEVEL ?? "info") as LogLevel });

  const ok = result.totals.inserts + result.totals.updates;
  console.log(`sync: ${ok} ok, ${result.errorCount} errors, ${result.durationMs}ms`);
  for (const sr of result.sources) {
    if (sr.errors.length > 0) {
      for (const e of sr.errors) console.error(`  [${sr.source}] ${e.entityId}: ${e.message}`);
    }
  }
  process.exit(result.errorCount > 0 ? 1 : 0);
}

main();
