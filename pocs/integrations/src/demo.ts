import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { integrate } from "./engine.js";
import { createMemoryEventStore } from "./staging/memory.js";
import { createDuckDbQueryStore } from "./staging/duckdb.js";
import { createStubGraphClient } from "./graph/stub.js";
import { createGraphClient } from "./graph/client.js";
import { postgresPipeline, mongoPipeline, type PipelineEnv } from "./pipelines.js";
import type { Pipeline } from "./transform/pipeline.js";
import type { GraphClient } from "./graph/types.js";
import type { LogLevel } from "./log.js";

const root = dirname(fileURLToPath(import.meta.url));

const env: PipelineEnv = {
  typeBase: process.env.HASH_TYPE_BASE ?? "http://localhost:3000/@e2e/types",
  webId: process.env.HASH_WEB_ID ?? "unknown",
};

const pipelines: Record<string, (env: PipelineEnv) => Pipeline> = {
  watermark: postgresPipeline,
  cdc: postgresPipeline,
  mongo: mongoPipeline,
  "mongo-stream": mongoPipeline,
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
const configPath = args.find((a) => !a.startsWith("--")) ?? resolve(root, "..", "integration-watermark.json");
const config = JSON.parse(readFileSync(resolve(configPath), "utf-8"));

const pipelineFactory = pipelines[config.mode as string] ?? postgresPipeline;

const app = integrate({
  connector: config,
  table: "users",
  eventStore: createMemoryEventStore(),
  queryStore: await createDuckDbQueryStore(),
  pipeline: pipelineFactory(env),
  graphClient: buildGraphClient(),
  logLevel,
});

process.on("SIGINT", () => { app.stop(); process.exit(0); });
app.run().catch((err) => { console.error(err); process.exit(1); });
