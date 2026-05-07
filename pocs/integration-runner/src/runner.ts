import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { resolveEnvVars, type IntegrationYaml } from "./schema.js";
import { buildConnectorDef, buildPipelines } from "./build.js";
import { loadConfig, workflowId } from "./config.js";
import { bindIntegration, launchDbos, shutdownDbos, runDurableSync } from "./orchestrate.js";
import { integrate, type IntegrationSpec } from "@integrations/engine.js";
import { createMemoryEventStore } from "@integrations/staging/memory.js";
import { createDuckDbQueryStore } from "@integrations/staging/duckdb.js";
import { createLocalStorage } from "@integrations/storage/local.js";
import { createGraphClient } from "@integrations/graph/client.js";
import { createStubGraphClient } from "@integrations/graph/stub.js";
import type { GraphClient } from "@integrations/graph/types.js";
import type { LogLevel } from "@integrations/log.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const yamlPath = process.argv[2];
if (!yamlPath) {
  console.error("Usage: tsx src/runner.ts <integration.yaml>");
  process.exit(1);
}

const raw = parseYaml(readFileSync(yamlPath, "utf8"));
const yaml: IntegrationYaml = resolveEnvVars(raw);
const config = loadConfig();

const connectorDef = buildConnectorDef(yaml);
const tablePipelines = buildPipelines(yaml);
const logLevel = (process.env.LOG_LEVEL ?? "info") as LogLevel;
const stagingRoot = process.env.STAGING_ROOT ?? "./staging";
const dbFile = process.env.DUCKDB_STATE_FILE ?? ".integration-state.duckdb";

const hasGraphSink = tablePipelines.some((tp) =>
  tp.pipeline.steps.some((s) => s.kind === "graph-sink"),
);

function buildGraphClient(): GraphClient | undefined {
  if (!hasGraphSink) return undefined;
  if (config.graphUrl && config.actorId) {
    return createGraphClient({ baseUrl: config.graphUrl, actorId: config.actorId });
  }
  console.log("[graph] stub (set HASH_GRAPH_URL + HASH_ACTOR_ID for real graph)");
  return createStubGraphClient();
}

const spec: IntegrationSpec = {
  connector: connectorDef,
  pipelines: tablePipelines,
  eventStore: createMemoryEventStore(),
  queryStore: await createDuckDbQueryStore(dbFile),
  storage: createLocalStorage({ root: stagingRoot }),
  graphClient: buildGraphClient(),
  logLevel,
};

const app = integrate(spec);

console.log(`[runner] ${connectorDef.id}: ${tablePipelines.length} pipelines, dbos=${config.dbosUrl ? "on" : "off"}`);

let result;
if (config.dbosUrl) {
  bindIntegration(app);
  await launchDbos(config.dbosUrl);
  const wfId = workflowId(connectorDef.id, config);
  console.log(`[runner] workflow=${wfId}`);
  try {
    result = await runDurableSync(wfId, app.getSourceOrder());
  } finally {
    await shutdownDbos();
  }
} else {
  result = await app.sync();
}

console.log(`sync: ${result.inserts + result.updates} ok, ${result.errors.length} errors, ${result.durationMs}ms`);
for (const err of result.errors) console.error(`  ${err.entityId}: ${err.message}`);
process.exit(result.errors.length > 0 ? 1 : 0);
