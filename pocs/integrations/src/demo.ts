import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { integrate } from "./engine.js";
import { createMemoryEventStore } from "./staging/memory.js";
import { createDuckDbQueryStore } from "./staging/duckdb.js";
import { postgresPipeline, mongoPipeline } from "./pipelines.js";
import { pipe, fnStep, type Pipeline } from "./transform/pipeline.js";

const root = dirname(fileURLToPath(import.meta.url));

const pipelines: Record<string, Pipeline> = {
  watermark: postgresPipeline,
  cdc: postgresPipeline,
  mongo: mongoPipeline,
  "mongo-stream": mongoPipeline,
};

const configPath = process.argv[2] ?? resolve(root, "..", "integration-watermark.json");
const config = JSON.parse(readFileSync(resolve(configPath), "utf-8"));
const basePipeline = pipelines[config.mode as string] ?? postgresPipeline;

const app = integrate({
  connector: config,
  table: "users",
  eventStore: createMemoryEventStore(),
  queryStore: await createDuckDbQueryStore(),
  pipeline: pipe(basePipeline, fnStep({
    id: "log",
    transform: (rows) => {
      for (const { _op, _key, ...props } of rows) console.log(`  [${_op.toUpperCase()}] ${_key} →`, props);
      return rows;
    },
  })),
  debug: true,
});

process.on("SIGINT", () => { app.stop(); process.exit(0); });
app.run().catch((err) => { console.error(err); process.exit(1); });
