import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnector, type ConnectorDef } from "./connector/index.js";

const root = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(process.argv[2] ?? resolve(root, "..", "integration.json"));
const def: ConnectorDef = JSON.parse(readFileSync(configPath, "utf-8"));
const connector = createConnector(def);
const table = process.argv[3] ?? Object.keys("tables" in def ? def.tables : def.collections)[0]!;

async function main() {
  const schema = await connector.introspect();
  for (const [name, tc] of Object.entries(schema)) {
    const cols = tc.columns?.map((c) => `${c.name} (${c.type})`).join(", ");
    console.log(`${name}: ${cols ?? "no column info"}`);
    if (tc.foreignKeys) console.log(`  fks: ${JSON.stringify(tc.foreignKeys)}`);
  }
  console.log();

  if (connector.mode !== "poll") { console.error("main.ts only supports poll connectors"); process.exit(1); }

  let cursor: unknown;
  while (true) {
    const { events, cursor: next } = await connector.pull(table, cursor);
    cursor = next;

    for (const ev of events) {
      console.log(`[${ev.op.toUpperCase()}] ${ev.table}`, ev.key);
      if (ev.row) console.log("  row:", ev.row);
      if (ev.before) console.log("  before:", ev.before);
    }
    if (events.length > 0) console.log(`cursor: ${cursor}\n`);
  }
}

let shuttingDown = false;
process.on("SIGINT", async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await connector.close();
  process.exit(0);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
