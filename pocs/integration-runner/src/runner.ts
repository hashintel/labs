import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { resolveEnvVars, type IntegrationYaml } from "./schema.js";
import { validateYaml } from "./validate.js";
import { loadConfig, workflowId, type RunnerConfig } from "./config.js";
import { integrationId } from "./identity.js";
import { createBackend, retryPolicyFrom, RunAlreadyActiveError } from "./orchestrator.js";
import { type WorkflowResult, buildWorkflowResult } from "./result.js";
import type { SyncInput } from "./sync-workflow.js";
import type { LogLevel } from "@integrations/log.js";

export type RunOpts = {
  yaml: IntegrationYaml;
  config: RunnerConfig;
  transformsPath?: string;
  logLevel?: LogLevel;
  linksOnly?: boolean;
};

/**
 * The CLI half: resolve everything environmental HERE (secrets, paths, knobs),
 * pack it into a serializable SyncInput, and hand it to the backend. The
 * workflow body (sync-workflow.ts) rebuilds live resources on whichever process
 * executes it; nothing is closed over.
 */
export function buildSyncInput(opts: RunOpts): SyncInput {
  const { yaml, config } = opts;
  return {
    yaml,
    runId: config.runId,
    linksOnly: opts.linksOnly ?? false,
    logLevel: opts.logLevel ?? "info",
    transformsPath: opts.transformsPath,
    retry: retryPolicyFrom(yaml.orchestration),
    runtime: {
      webId: config.webId,
      actorId: config.actorId,
      graphUrl: config.graphUrl,
      baseDir: config.baseDir,
      duckdb: {
        sandboxOff: process.env.DUCKDB_SANDBOX === "off",
        sourceFolder: process.env.SOURCE_FOLDER,
        allowedExtraDirs: (process.env.DUCKDB_ALLOWED_DIRS ?? "").split(":").filter(Boolean),
        memoryLimit: process.env.DUCKDB_MEMORY_LIMIT,
        maxTempDirectorySize: process.env.DUCKDB_MAX_TEMP_SIZE,
        threads: process.env.DUCKDB_THREADS ? Number(process.env.DUCKDB_THREADS) : undefined,
      },
    },
    limits: {
      webOpsPerSec: config.webOpsPerSec,
      opsPerSecOverride: yaml.orchestration?.opsPerSec,
    },
  };
}

export async function run(opts: RunOpts): Promise<WorkflowResult> {
  const { yaml, config } = opts;
  const id = integrationId(yaml, config.webId);
  const input = buildSyncInput(opts);

  const backendKind = config.dbosUrl ? "dbos" : "direct";
  console.log(`[runner] ${id.canonical} (${id.configHash}): backend=${backendKind}`);

  const backend = await createBackend(
    config.dbosUrl
      ? { kind: "dbos", databaseUrl: config.dbosUrl, maxConcurrentRuns: config.maxConcurrentRuns }
      : { kind: "direct" },
  );

  const startedAt = new Date().toISOString();
  try {
    const results = await backend.invoke(workflowId(id, config.runId), input, { dedupKey: id.canonical });
    return buildWorkflowResult(id.canonical, id.configHash, results, startedAt);
  } finally {
    await backend.shutdown();
  }
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");

  const args = process.argv.slice(2);
  const yamlPath = args.find((a) => !a.startsWith("--"));
  const transformsPath = args.find((a) => a.startsWith("--transforms="))?.split("=")[1];

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
  const linksOnly = args.includes("--links-only");

  let result: WorkflowResult;
  try {
    result = await run({ yaml, config, transformsPath, logLevel: (process.env.LOG_LEVEL ?? "info") as LogLevel, linksOnly });
  } catch (err) {
    if (err instanceof RunAlreadyActiveError) {
      console.error(`[runner] ${err.message}`);
      process.exit(2);
    }
    console.error(`[runner] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

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
