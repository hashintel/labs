import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnector, type ConnectorDef } from "./connector/index.js";
import { createDuckDbStaging } from "./staging/duckdb.js";
import { META_COLUMNS } from "./staging/types.js";
import { mongoPipeline } from "./pipelines.js";
import { integrate } from "./engine.js";

const root = dirname(fileURLToPath(import.meta.url));
const def: ConnectorDef = JSON.parse(readFileSync(resolve(process.argv[2] ?? resolve(root, "..", "integration-mongo.json")), "utf-8"));
const store = await createDuckDbStaging();

const app = integrate({
  connector: createConnector(def),
  table: "users",
  eventStore: store,
  queryStore: store,
  pipeline: mongoPipeline,
  opts: {
    debug: true,
    forEach: (row) => {
      const { [META_COLUMNS.op]: op, [META_COLUMNS.key]: key, ...props } = row;
      console.log(`  [${String(op).toUpperCase()}] ${key} →`, props);
    },
  },
});

process.on("SIGINT", () => app.stop());
app.run().catch((err) => { console.error(err); process.exit(1); });
