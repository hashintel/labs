import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { integrate, type TablePipeline } from "./engine.js";
import { createMemoryEventStore } from "./staging/memory.js";
import { createDuckDbQueryStore } from "./staging/duckdb.js";
import { createStubGraphClient } from "./graph/stub.js";
import { createGraphClient } from "./graph/client.js";
import { postgresPipelines, mongoPipelines, type PipelineEnv } from "./pipelines.js";
import type { GraphClient } from "./graph/types.js";
import type { LogLevel } from "./log.js";

const root = dirname(fileURLToPath(import.meta.url));

const env: PipelineEnv = {
  typeBase: process.env.HASH_TYPE_BASE ?? "http://localhost:3000/@e2e/types",
  webId: process.env.HASH_WEB_ID ?? "unknown",
};

const pipelineFactories: Record<string, (env: PipelineEnv) => TablePipeline[]> = {
  batch: postgresPipelines,
  cdc: postgresPipelines,
  "mongo-stream": mongoPipelines,
};

function buildGraphClient(): GraphClient {
  const baseUrl = process.env.HASH_GRAPH_URL;
  const actorId = process.env.HASH_ACTOR_ID;
  if (baseUrl && actorId) {
    console.log(`[graph] ${baseUrl}`);
    return createGraphClient({ baseUrl, actorId });
  }
  console.log("[graph] stub (set HASH_GRAPH_URL + HASH_ACTOR_ID for real graph)");
  return createStubGraphClient();
}

const args = process.argv.slice(2);
const logLevel = (args.find((a) => a.startsWith("--log="))?.split("=")[1] ?? "debug") as LogLevel;
const configPath = args.find((a) => !a.startsWith("--")) ?? resolve(root, "..", "integration.json");
const config = JSON.parse(readFileSync(resolve(configPath), "utf-8"));

const mode = config.mode as string;
const factory = pipelineFactories[mode] ?? postgresPipelines;
const isBatch = mode === "batch" || mode === "rest-api";

const app = integrate({
  connector: config,
  pipelines: factory(env),
  eventStore: createMemoryEventStore(),
  queryStore: await createDuckDbQueryStore(isBatch ? ".integration-state.db" : undefined),
  graphClient: buildGraphClient(),
  logLevel,
});

process.on("SIGINT", () => { app.stop(); process.exit(0); });
app.run().catch((err) => { console.error(err); process.exit(1); });
