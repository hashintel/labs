import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { createConnector, type ConnectorDef } from "./connector/index.js";
import { createStagingDb, META_COLUMNS } from "./staging/db.js";
import { pipe, sql, ts, runPipeline, validatePipeline } from "./transform/types.js";
import { formatDuckSchema } from "./transform/schema.js";

const root = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(process.argv[2] ?? resolve(root, "..", "integration-watermark.json"));
const def: ConnectorDef = JSON.parse(readFileSync(configPath, "utf-8"));
const connector = createConnector(def);

const UserEntity = Schema.Struct({
  primaryKey: Schema.String,
  email: Schema.String,
  displayName: Schema.String,
  orgId: Schema.String,
});
type UserEntity = typeof UserEntity.Type;

const EnrichedUser = Schema.Struct({
  ...UserEntity.fields,
  emailUpper: Schema.String,
});
type EnrichedUser = typeof EnrichedUser.Type;

const usersPipeline = pipe(`${def.id}/users`,
  sql({ id: "clean-names", query: `SELECT *, trim(first_name || ' ' || last_name) AS full_name FROM input`, key: "id" }),
  sql({ id: "map-entities", query: `SELECT id AS "primaryKey", email, full_name AS "displayName", organization_id AS "orgId" FROM input`, key: "id", output: UserEntity }),
  ts<UserEntity, EnrichedUser>({
    id: "upper-email",
    transform: (rows) => rows.map((r) => ({ ...r, emailUpper: r.email.toUpperCase() })),
    output: EnrichedUser,
  }),
);

async function main() {
  const db = await createStagingDb();

  const { events, cursor } = await connector.pull("users", undefined);
  console.log(`Pulled ${events.length} events (cursor: ${cursor})\n`);
  await db.loadEvents(def.id, events);

  await validatePipeline(usersPipeline, db);
  const result = await runPipeline(usersPipeline, db);

  const { rows: finalRows } = await db.query(`SELECT * FROM "${result.outputTable}"`);
  console.log(`Final output (${formatDuckSchema(result.stepResults["upper-email"].duckSchema)}):\n`);
  console.table(finalRows);

  console.log("\nSink actions:");
  for (const row of finalRows) {
    const op = row[META_COLUMNS.op] as string;
    const key = JSON.parse(row[META_COLUMNS.key] as string);
    const { [META_COLUMNS.op]: _, [META_COLUMNS.key]: __, ...properties } = row;

    if (op === "delete") console.log(`  ARCHIVE entity ${JSON.stringify(key)}`);
    else console.log(`  UPSERT entity ${JSON.stringify(key)} →`, properties);
  }

  db.close();
  await connector.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
