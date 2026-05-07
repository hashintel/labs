import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";
import { resolveEnvVars } from "../src/schema.js";
import { buildConnectorDef, buildPipelines } from "../src/build.js";
import { integrate } from "@integrations/engine.js";
import { createMemoryEventStore } from "@integrations/staging/memory.js";
import { createDuckDbQueryStore } from "@integrations/staging/duckdb.js";
import { createLocalStorage } from "@integrations/storage/local.js";
import { createStubGraphClient } from "@integrations/graph/stub.js";

if (existsSync(".env")) process.loadEnvFile(".env");
process.env.HASH_WEB_ID ??= "test-web";

const yaml = resolveEnvVars(parse(readFileSync("test/aviation.yaml", "utf8")));
const app = integrate({
  connector: buildConnectorDef(yaml),
  pipelines: buildPipelines(yaml),
  eventStore: createMemoryEventStore(),
  queryStore: await createDuckDbQueryStore(".integration-state.duckdb"),
  storage: createLocalStorage({ root: "./staging" }),
  graphClient: createStubGraphClient(),
  logLevel: "debug",
});

const result = await app.sync();
console.log("\n=== RESULT ===");
console.log(`inserts=${result.inserts} updates=${result.updates} deletes=${result.deletes} unchanged=${result.unchanged}`);
console.log(`errors=${result.errors.length}`);
for (const e of result.errors) console.log(`  ${e.kind} ${e.entityId}: ${e.message}`);
