import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnector, type ConnectorDef } from "./connector/index.js";
import { createStagingDb, META_COLUMNS } from "./staging/db.js";
import { pipe, sql, runPipeline } from "./transform/types.js";

const root = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(process.argv[2] ?? resolve(root, "..", "integration.json"));
const def: ConnectorDef = JSON.parse(readFileSync(configPath, "utf-8"));
const connector = createConnector(def);

const usersPipeline = pipe(`${def.id}/users`,
  sql({ id: "map", query: `SELECT id AS "primaryKey", email, first_name || ' ' || last_name AS "displayName" FROM input`, key: "id" }),
);

async function main() {
  const db = await createStagingDb();
  let cursor: unknown;

  console.log("Listening for CDC events, transforming, and sinking...\n");

  while (true) {
    const { events, cursor: next } = await connector.pull("users", cursor);
    cursor = next;
    if (events.length === 0) continue;

    await db.loadEvents(def.id, events);
    const result = await runPipeline(usersPipeline, db);
    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}"`);

    for (const row of rows) {
      const op = row[META_COLUMNS.op] as string;
      const key = JSON.parse(row[META_COLUMNS.key] as string);
      const { [META_COLUMNS.op]: _, [META_COLUMNS.key]: __, ...properties } = row;

      if (op === "delete") console.log(`[DELETE] ARCHIVE entity ${JSON.stringify(key)}`);
      else console.log(`[${op.toUpperCase()}] UPSERT entity ${JSON.stringify(key)} →`, properties);
    }

    await db.exec(`DROP TABLE IF EXISTS "${def.id}/users"`);
    if (rows.length > 0) console.log();
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
