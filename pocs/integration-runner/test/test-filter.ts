import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";
import { resolveEnvVars } from "../src/schema.js";
import { buildConnectorDef, buildPipelines } from "../src/build.js";
import { integrate } from "@integrations/engine.js";
import { createMemoryEventStore } from "@integrations/staging/memory.js";
import { createDuckDbQueryStore } from "@integrations/staging/duckdb.js";
import { createLocalStorage } from "@integrations/storage/local.js";

const yaml = resolveEnvVars(parse(readFileSync("test/deps.yaml", "utf8")));
const app = integrate({
  connector: buildConnectorDef(yaml),
  pipelines: buildPipelines(yaml),
  eventStore: createMemoryEventStore(),
  queryStore: await createDuckDbQueryStore(".integration-state.duckdb"),
  storage: createLocalStorage({ root: "./staging" }),
});

console.log("source order:", app.getSourceOrder());

const r = await app.syncSources(["raw"]);
console.log("filtered sync:", r.inserts, "inserts", r.errors.length, "errors");

console.log("raw-cp exists:", existsSync("staging/checkpoints/raw-cp.parquet"));
console.log("derived-cp exists:", existsSync("staging/checkpoints/derived-cp.parquet"));
