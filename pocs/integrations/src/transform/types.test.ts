import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Schema } from "effect";
import { DuckDBTypeId } from "@duckdb/node-api";
import { createStagingDb, META_COLUMNS, type StagingDb } from "../staging/db.js";
import { pipe, sql, ts, runPipeline, validatePipeline } from "./types.js";

let db: StagingDb;

afterEach(() => db?.close());

async function seedUsers(db: StagingDb) {
  await db.loadEvents("test", [
    { table: "users", op: "insert", key: { id: 1 }, row: { id: "1", email: "alice@acme.com", first_name: "Alice", last_name: "Smith" } },
    { table: "users", op: "update", key: { id: 2 }, row: { id: "2", email: "bob@acme.com", first_name: "Bob", last_name: "Jones" } },
    { table: "users", op: "delete", key: { id: 3 }, row: null },
  ]);
}

describe("pipe + runPipeline", () => {
  it("auto-preserves _op/_key through SQL", async () => {
    db = await createStagingDb();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users",
      sql({ id: "pass", query: `SELECT * FROM input`, key: "id" }),
    ), db);
    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}"`);

    assert.equal(rows.length, 3);
    assert.equal(rows[0][META_COLUMNS.op], "insert");
    assert.equal(rows[1][META_COLUMNS.op], "update");
    assert.equal(rows[2][META_COLUMNS.op], "delete");
  });

  it("chains SQL steps", async () => {
    db = await createStagingDb();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users",
      sql({ id: "fullname", query: `SELECT *, first_name || ' ' || last_name AS full_name FROM input`, key: "id" }),
      sql({ id: "pick", query: `SELECT id, email, full_name FROM input`, key: "id" }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}" WHERE _op != 'delete'`);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].full_name, "Alice Smith");
    assert.ok(rows[0][META_COLUMNS.op]);
  });

  it("SQL filter preserves correct _op/_key via key join", async () => {
    db = await createStagingDb();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users",
      sql({ id: "filter", query: `SELECT * FROM input WHERE email LIKE '%acme%'`, key: "id" }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}" WHERE _op != 'delete' ORDER BY id`);
    assert.equal(rows.length, 2);

    const ops = new Set(rows.map((r) => r[META_COLUMNS.op]));
    assert.ok(ops.has("insert"));
    assert.ok(ops.has("update"));

    const keys = rows.map((r) => JSON.parse(r[META_COLUMNS.key] as string).id);
    assert.ok(keys.includes(1));
    assert.ok(keys.includes(2));
  });

  it("auto-strips and re-attaches envelope for TS steps", async () => {
    db = await createStagingDb();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users",
      ts({ id: "upper", transform: (rows) => rows.map((r) => ({ ...r, email: r.email ? String(r.email).toUpperCase() : null })) }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}" WHERE _op = 'insert'`);
    assert.equal(rows[0].email, "ALICE@ACME.COM");
    assert.equal(rows[0][META_COLUMNS.op], "insert");
  });

  it("TS step receives clean rows without _op/_key", async () => {
    db = await createStagingDb();
    await seedUsers(db);

    let receivedKeys: string[] = [];
    await runPipeline(pipe("test/users",
      ts({ id: "inspect", transform: (rows) => { receivedKeys = Object.keys(rows[0]); return rows; } }),
    ), db);

    assert.ok(!receivedKeys.includes("_op"));
    assert.ok(!receivedKeys.includes("_key"));
    assert.ok(receivedKeys.includes("email"));
  });

  it("mixes SQL and TS steps", async () => {
    db = await createStagingDb();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users",
      sql({ id: "filter", query: `SELECT * FROM input WHERE id IS NOT NULL`, key: "id" }),
      ts({ id: "tag", transform: (rows) => rows.map((r) => ({ ...r, source: "crm" })) }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}" WHERE _op != 'delete'`);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].source, "crm");
    assert.ok(rows[0][META_COLUMNS.op]);
  });

  it("handles empty pipeline (zero steps)", async () => {
    db = await createStagingDb();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users"), db);
    assert.equal(result.outputTable, "test/users");
    assert.deepEqual(result.stepResults, {});
  });

  it("populates stepResults with DuckDB schema", async () => {
    db = await createStagingDb();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users",
      sql({ id: "pass", query: `SELECT * FROM input`, key: "id" }),
    ), db);
    const schema = result.stepResults["pass"].duckSchema;
    assert.ok(schema.length > 0);
    assert.ok(schema.some((c) => c.name === "_op"));
  });

  it("handles all-delete input", async () => {
    db = await createStagingDb();
    await db.loadEvents("test", [
      { table: "users", op: "delete", key: { id: 1 }, row: null },
      { table: "users", op: "delete", key: { id: 2 }, row: null },
    ]);

    const result = await runPipeline(pipe("test/users",
      sql({ id: "pass", query: `SELECT * FROM input`, key: "id" }),
    ), db);
    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}"`);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r[META_COLUMNS.op] === "delete"));
  });

  it("second run overwrites step tables", async () => {
    db = await createStagingDb();
    await seedUsers(db);

    const p = pipe("test/users", sql({ id: "pass", query: `SELECT * FROM input`, key: "id" }));
    await runPipeline(p, db);
    const result = await runPipeline(p, db);

    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}"`);
    assert.equal(rows.length, 3);
  });
});

describe("validatePipeline", () => {
  it("passes for valid SQL steps", async () => {
    db = await createStagingDb();
    await seedUsers(db);
    await validatePipeline(pipe("test/users", sql({ id: "ok", query: `SELECT * FROM input`, key: "id" })), db);
  });

  it("throws for SQL referencing nonexistent column", async () => {
    db = await createStagingDb();
    await seedUsers(db);
    await assert.rejects(() => validatePipeline(pipe("test/users", sql({ id: "bad", query: `SELECT nope FROM input`, key: "id" })), db));
  });

  it("skips TS steps without error", async () => {
    db = await createStagingDb();
    await seedUsers(db);
    await validatePipeline(pipe("test/users",
      sql({ id: "first", query: `SELECT * FROM input`, key: "id" }),
      ts({ id: "middle", transform: (rows) => rows }),
      sql({ id: "last", query: `SELECT * FROM input`, key: "id" }),
    ), db);
  });
});

describe("Effect Schema validation", () => {
  const UserOut = Schema.Struct({ id: Schema.String, email: Schema.String });

  it("validates SQL step output against declared schema", async () => {
    db = await createStagingDb();
    await seedUsers(db);

    const result = await runPipeline(pipe("test/users",
      sql({ id: "pick", query: `SELECT id, email FROM input`, key: "id", output: UserOut }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}"`);
    assert.equal(rows.length, 3);
  });

  it("validatePipeline catches missing schema column", async () => {
    db = await createStagingDb();
    await seedUsers(db);

    const Bad = Schema.Struct({ nope: Schema.String });

    await assert.rejects(
      () => validatePipeline(pipe("test/users", sql({ id: "pick", query: `SELECT id FROM input`, key: "id", output: Bad })), db),
      (err: Error) => err.message.includes("nope"),
    );
  });

  it("TS step validates clean rows (no _op/_key in schema)", async () => {
    db = await createStagingDb();
    await seedUsers(db);

    const UserIn = Schema.Struct({ id: Schema.String, email: Schema.String });

    const result = await runPipeline(pipe("test/users",
      sql({ id: "pick", query: `SELECT id, email FROM input`, key: "id" }),
      ts({ id: "check", transform: (rows) => rows, input: UserIn }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${result.outputTable}"`);
    assert.equal(rows.length, 3);
  });
});
