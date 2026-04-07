import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Schema } from "effect";
import { createDuckDbStaging, type DuckDbStaging } from "../staging/duckdb.js";
import { META_COLUMNS } from "../staging/types.js";
import { pipe, sql, ts, runPipeline, validatePipeline } from "./types.js";

let db: DuckDbStaging;

afterEach(() => db?.close());

async function seedUsers(db: DuckDbStaging) {
  const events = [
    { table: "users", op: "insert" as const, key: { id: 1 }, row: { id: "1", email: "alice@example.com", first_name: "Alice", last_name: "Smith" } },
    { table: "users", op: "update" as const, key: { id: 2 }, row: { id: "2", email: "bob@example.com", first_name: "Bob", last_name: "Jones" } },
    { table: "users", op: "delete" as const, key: { id: 3 }, row: null },
  ];
  await db.append("test", "users", events);
  await db.materialize("test", "users");
}

describe("pipe + runPipeline", () => {
  it("SELECT * carries _op/_key through", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users",
      sql({ id: "pass", query: `SELECT * FROM input` }),
    ), db);
    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}"`);

    assert.equal(rows.length, 3);
    assert.ok(rows.some((r) => r[META_COLUMNS.op] === "insert"));
    assert.ok(rows.some((r) => r[META_COLUMNS.op] === "update"));
    assert.ok(rows.some((r) => r[META_COLUMNS.op] === "delete"));
  });

  it("chains SQL steps", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users",
      sql({ id: "fullname", query: `SELECT *, first_name || ' ' || last_name AS full_name FROM input` }),
      sql({ id: "pick", query: `SELECT _op, _key, id, email, full_name FROM input` }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}" WHERE _op != 'delete' ORDER BY id`);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].full_name, "Alice Smith");
    assert.equal(rows[1].full_name, "Bob Jones");
  });

  it("SQL WHERE filter works with full SQL power", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users",
      sql({ id: "filter", query: `SELECT * FROM input WHERE email LIKE '%example%'` }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}" ORDER BY id`);
    assert.equal(rows.length, 2);
    assert.equal(rows[0][META_COLUMNS.op], "insert");
    assert.equal(rows[1][META_COLUMNS.op], "update");
  });

  it("SQL aggregation works when user provides _op/_key", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users",
      sql({ id: "count", query: `SELECT 'aggregate' AS _op, '{}' AS _key, count(*) AS total FROM input WHERE _op != 'delete'` }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}"`);
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0].total), "2");
    assert.equal(rows[0][META_COLUMNS.op], "aggregate");
  });

  it("TS step sees _op and _key, carries them through via spread", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users",
      ts({ id: "upper", transform: (rows) => rows.map((r) => ({ ...r, email: r.email ? String(r.email).toUpperCase() : null })) }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}" WHERE _op = 'insert'`);
    assert.equal(rows[0].email, "ALICE@EXAMPLE.COM");
    assert.equal(rows[0][META_COLUMNS.op], "insert");
  });

  it("TS step receives _op and _key alongside data", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    let receivedKeys: string[] = [];
    await runPipeline(pipe("test/users",
      ts({ id: "inspect", transform: (rows) => { receivedKeys = Object.keys(rows[0]); return rows; } }),
    ), db);

    assert.ok(receivedKeys.includes("_op"));
    assert.ok(receivedKeys.includes("_key"));
    assert.ok(receivedKeys.includes("email"));
  });

  it("TS step can filter rows", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users",
      ts({ id: "filter", transform: (rows) => rows.filter((r) => r.email && String(r.email).includes("example")) }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}"`);
    assert.equal(rows.length, 2);
    assert.ok(rows.some((r) => r[META_COLUMNS.op] === "insert"));
    assert.ok(rows.some((r) => r[META_COLUMNS.op] === "update"));
  });

  it("TS step that drops _op/_key throws", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    await assert.rejects(
      () => runPipeline(pipe("test/users",
        ts({ id: "bad", transform: (rows) => rows.map(({ _op, _key, ...data }) => data) }),
      ), db),
      (err: Error) => err.message.includes("missing"),
    );
  });

  it("mixes SQL and TS steps", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users",
      sql({ id: "filter", query: `SELECT * FROM input WHERE _op != 'delete'` }),
      ts({ id: "tag", transform: (rows) => rows.map((r) => ({ ...r, source: "crm" })) }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}"`);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].source, "crm");
    assert.ok(rows[0][META_COLUMNS.op]);
  });

  it("handles empty pipeline (zero steps)", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users"), db);
    assert.equal(result.outputTable, "test/users");
    assert.deepEqual(result.stepResults, {});
  });

  it("handles all-delete input", async () => {
    db = await createDuckDbStaging();
    const deletes = [
      { table: "users", op: "delete" as const, key: { id: 1 }, row: null },
      { table: "users", op: "delete" as const, key: { id: 2 }, row: null },
    ];
    await db.append("test", "users", deletes);
    await db.materialize("test", "users");

    const result = await runPipeline(pipe("test/users",
      sql({ id: "pass", query: `SELECT * FROM input` }),
    ), db);
    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}"`);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r[META_COLUMNS.op] === "delete"));
  });

  it("second run overwrites step tables", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    const p = pipe("test/users", sql({ id: "pass", query: `SELECT * FROM input` }));
    await runPipeline(p, db);
    const result = await runPipeline(p, db);

    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}"`);
    assert.equal(rows.length, 3);
  });
});

describe("_op/_key enforcement (SQL)", () => {
  it("throws when SQL step drops _op/_key", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    await assert.rejects(
      () => runPipeline(pipe("test/users", sql({ id: "bad", query: `SELECT id, email FROM input` })), db),
      (err: Error) => err.message.includes("missing"),
    );
  });
});

describe("validatePipeline", () => {
  it("passes for valid SQL steps", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);
    await validatePipeline(pipe("test/users", sql({ id: "ok", query: `SELECT * FROM input` })), db);
  });

  it("throws for SQL referencing nonexistent column", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);
    await assert.rejects(() => validatePipeline(pipe("test/users", sql({ id: "bad", query: `SELECT nope FROM input` })), db));
  });

  it("catches _op/_key drop at validation time", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);
    await assert.rejects(
      () => validatePipeline(pipe("test/users", sql({ id: "bad", query: `SELECT id FROM input` })), db),
      (err: Error) => err.message.includes("missing"),
    );
  });

  it("skips TS steps", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);
    await validatePipeline(pipe("test/users",
      sql({ id: "first", query: `SELECT * FROM input` }),
      ts({ id: "middle", transform: (rows) => rows }),
      sql({ id: "last", query: `SELECT * FROM input` }),
    ), db);
  });
});

describe("Effect Schema validation", () => {
  const UserOut = Schema.Struct({ id: Schema.String, email: Schema.String });

  it("validates SQL step output (schema excludes _op/_key)", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users",
      sql({ id: "pick", query: `SELECT _op, _key, id, email FROM input`, output: UserOut }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}"`);
    assert.equal(rows.length, 3);
  });

  it("validatePipeline catches missing schema column", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    const Bad = Schema.Struct({ nope: Schema.String });

    await assert.rejects(
      () => validatePipeline(pipe("test/users", sql({ id: "pick", query: `SELECT _op, _key, id FROM input`, output: Bad })), db),
      (err: Error) => err.message.includes("nope"),
    );
  });

  it("TS step validates clean rows (no _op/_key in schema)", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    const UserIn = Schema.Struct({ id: Schema.String, email: Schema.String });

    const result = await runPipeline(pipe("test/users",
      sql({ id: "pick", query: `SELECT _op, _key, id, email FROM input` }),
      ts({ id: "check", transform: (rows) => rows, input: UserIn }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}"`);
    assert.equal(rows.length, 3);
  });

  it("validatePipeline catches TS input schema incompatible with preceding SQL output", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    const WantsName = Schema.Struct({ full_name: Schema.String });

    await assert.rejects(
      () => validatePipeline(pipe("test/users",
        sql({ id: "pick", query: `SELECT _op, _key, id, email FROM input` }),
        ts({ id: "needs-name", transform: (rows) => rows, input: WantsName }),
      ), db),
      (err: Error) => err.message.includes("full_name") && err.message.includes("needs-name"),
    );
  });

  it("validatePipeline passes when TS input schema matches preceding SQL output", async () => {
    db = await createDuckDbStaging();
    await seedUsers(db);

    const HasIdEmail = Schema.Struct({ id: Schema.String, email: Schema.String });

    await validatePipeline(pipe("test/users",
      sql({ id: "pick", query: `SELECT _op, _key, id, email FROM input` }),
      ts({ id: "ok", transform: (rows) => rows, input: HasIdEmail }),
    ), db);
  });
});
