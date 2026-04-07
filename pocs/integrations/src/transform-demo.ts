import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { createConnector, type ConnectorDef } from "./connector/index.js";
import { createDuckDbStaging } from "./staging/duckdb.js";
import { META_COLUMNS } from "./staging/types.js";
import {
  pipe,
  sql,
  ts,
  runPipeline,
  validatePipeline,
} from "./transform/types.js";
import { formatDuckSchema } from "./transform/schema.js";

const root = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(
  process.argv[2] ?? resolve(root, "..", "integration-watermark.json"),
);
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

const usersPipeline = pipe(
  `${def.id}/users`,
  sql({
    id: "clean-names",
    query: `SELECT *, trim(first_name || ' ' || last_name) AS full_name FROM input`,
  }),
  sql({
    id: "map-entities",
    query: `SELECT _op, _key, id AS "primaryKey", email, full_name AS "displayName", organization_id AS "orgId" FROM input`,
    output: UserEntity,
  }),
  ts<UserEntity, EnrichedUser>({
    id: "upper-email",
    transform: (rows) =>
      rows.map((r) => ({ ...r, emailUpper: r.email.toUpperCase() })),
    output: EnrichedUser,
  }),
);

function printSinkActions(rows: Record<string, unknown>[]) {
  for (const row of rows) {
    const op = row[META_COLUMNS.op] as string;
    const key = JSON.parse(row[META_COLUMNS.key] as string);
    const { [META_COLUMNS.op]: _, [META_COLUMNS.key]: __, ...properties } = row;

    if (op === "delete") console.log(`  ARCHIVE entity ${JSON.stringify(key)}`);
    else console.log(`  UPSERT entity ${JSON.stringify(key)} →`, properties);
  }
}

async function main() {
  const db = await createDuckDbStaging();
  let cursor: unknown;
  let validated = false;

  console.log(`Mode: ${def.mode}\n`);

  while (true) {
    const { events, cursor: next } = await connector.pull("users", cursor);
    cursor = next;

    if (events.length === 0) {
      if (def.mode === "watermark") break;
      continue;
    }

    console.log(`Pulled ${events.length} events (cursor: ${cursor})`);
    await db.append(def.id, "users", events);
    await db.materialize(def.id, "users");

    if (!validated) {
      await validatePipeline(usersPipeline, db, { debug: true });
      validated = true;
    }

    const result = await runPipeline(usersPipeline, db);
    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}"`);

    console.log(
      `Output (${formatDuckSchema(result.stepResults["upper-email"].duckSchema)}):`,
    );
    printSinkActions(rows);
    console.log();

    await db.exec(`DROP TABLE IF EXISTS "${def.id}/users"`);

    if (def.mode === "watermark") break;
  }

  db.close();
  await connector.close();
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
