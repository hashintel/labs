import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { integrate, type IntegrationSpec } from "./engine.js";
import { createDuckDbStaging } from "./staging/duckdb.js";
import { postgresPipeline, mongoPipeline } from "./pipelines.js";
import { pipe, lambdaStep, type Pipeline } from "./transform/pipeline.js";

const root = dirname(fileURLToPath(import.meta.url));

const pipelines: Record<string, Pipeline> = {
  watermark: postgresPipeline,
  cdc: postgresPipeline,
  mongo: mongoPipeline,
  "mongo-stream": mongoPipeline,
};

const defaultConfigs: Record<string, string> = {
  watermark: "integration-watermark.json",
  cdc: "integration.json",
  mongo: "integration-mongo.json",
  "mongo-stream": "integration-mongo-stream.json",
};

const configPath = process.argv[2] ?? resolve(root, "..", "integration-watermark.json");
const config = JSON.parse(readFileSync(resolve(configPath), "utf-8"));
const basePipeline = pipelines[config.mode as string] ?? postgresPipeline;

const spec: IntegrationSpec = {
  connector: config,
  table: "users",
  store: { kind: "duckdb" },
  pipeline: pipe(basePipeline, lambdaStep({
    id: "log",
    transform: (rows) => {
      for (const { _op, _key, ...props } of rows) console.log(`  [${_op.toUpperCase()}] ${_key} →`, props);
      return rows;
    },
  })),
  debug: true,
};

const app = integrate(spec, {
  stores: {
    duckdb: async () => {
      const store = await createDuckDbStaging();
      return { eventStore: store, queryStore: store };
    },
  },
});

process.on("SIGINT", () => { app.stop(); process.exit(0); });
app.run().catch((err) => { console.error(err); process.exit(1); });
