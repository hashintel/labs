import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DuckDBTypeId } from "@duckdb/node-api";
import { createStagingDb, META_COLUMNS, type StagingDb } from "./db.js";
import type { ChangeEvent } from "../connector/types.js";

let db: StagingDb;

afterEach(() => db?.close());

function ev(table: string, op: ChangeEvent["op"], key: Record<string, unknown>, row: Record<string, unknown> | null): ChangeEvent {
  return { table, op, key, row };
}

describe("loadEvents", () => {
  it("loads inserts with _op and _key", async () => {
    db = await createStagingDb();
    await db.loadEvents("t", [
      ev("users", "insert", { id: 1 }, { id: "1", email: "a@b.com" }),
      ev("users", "insert", { id: 2 }, { id: "2", email: "c@d.com" }),
    ]);

    const { rows } = await db.query(`SELECT * FROM "t/users"`);
    assert.equal(rows.length, 2);
    assert.equal(rows[0][META_COLUMNS.op], "insert");
    assert.equal(JSON.parse(rows[0][META_COLUMNS.key] as string).id, 1);
    assert.equal(rows[0].email, "a@b.com");
  });

  it("preserves update op", async () => {
    db = await createStagingDb();
    await db.loadEvents("t", [
      ev("users", "update", { id: 1 }, { id: "1", email: "new@b.com" }),
    ]);

    const { rows } = await db.query(`SELECT * FROM "t/users"`);
    assert.equal(rows[0][META_COLUMNS.op], "update");
  });

  it("loads deletes with null data columns", async () => {
    db = await createStagingDb();
    await db.loadEvents("t", [
      ev("users", "insert", { id: 1 }, { id: "1", email: "a@b.com" }),
      ev("users", "delete", { id: 1 }, null),
    ]);

    const { rows } = await db.query(`SELECT * FROM "t/users" WHERE _op = 'delete'`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, null);
  });

  it("handles batch of only deletes", async () => {
    db = await createStagingDb();
    await db.loadEvents("t", [ev("users", "delete", { id: 1 }, null)]);

    const { rows } = await db.query(`SELECT * FROM "t/users"`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][META_COLUMNS.op], "delete");
  });

  it("skips empty event list", async () => {
    db = await createStagingDb();
    await db.loadEvents("t", []);
  });

  it("loads events for multiple tables in one call", async () => {
    db = await createStagingDb();
    await db.loadEvents("t", [
      ev("users", "insert", { id: 1 }, { id: "1", email: "a@b.com" }),
      ev("orgs", "insert", { id: 10 }, { id: "10", name: "Acme" }),
    ]);

    const { rows: users } = await db.query(`SELECT * FROM "t/users"`);
    const { rows: orgs } = await db.query(`SELECT * FROM "t/orgs"`);
    assert.equal(users.length, 1);
    assert.equal(orgs.length, 1);
    assert.equal(orgs[0].name, "Acme");
  });

  it("serializes compound keys as JSON", async () => {
    db = await createStagingDb();
    await db.loadEvents("t", [
      ev("lines", "insert", { order_id: 1, line_id: 2 }, { order_id: "1", line_id: "2", qty: "5" }),
    ]);

    const { rows } = await db.query(`SELECT * FROM "t/lines"`);
    const key = JSON.parse(rows[0][META_COLUMNS.key] as string);
    assert.equal(key.order_id, 1);
    assert.equal(key.line_id, 2);
  });

  it("handles values with special characters", async () => {
    db = await createStagingDb();
    await db.loadEvents("t", [
      ev("users", "insert", { id: 1 }, { id: "1", name: "O'Malley \"Bob\"", bio: "line1\nline2" }),
    ]);

    const { rows } = await db.query(`SELECT * FROM "t/users"`);
    assert.equal(rows[0].name, "O'Malley \"Bob\"");
    assert.equal(rows[0].bio, "line1\nline2");
  });

  it("appends to existing table on subsequent calls", async () => {
    db = await createStagingDb();
    await db.loadEvents("t", [ev("users", "insert", { id: 1 }, { id: "1", email: "a@b.com" })]);
    await db.loadEvents("t", [ev("users", "insert", { id: 2 }, { id: "2", email: "c@d.com" })]);

    const { rows } = await db.query(`SELECT * FROM "t/users"`);
    assert.equal(rows.length, 2);
  });
});

describe("query", () => {
  it("returns duckSchema alongside rows", async () => {
    db = await createStagingDb();
    await db.exec(`CREATE TABLE test (id INTEGER, name VARCHAR)`);
    await db.exec(`INSERT INTO test VALUES (1, 'alice')`);

    const { rows, duckSchema } = await db.query(`SELECT * FROM test`);
    assert.equal(rows.length, 1);
    assert.equal(duckSchema.length, 2);
    assert.equal(duckSchema[0].name, "id");
    assert.equal(duckSchema[0].typeId, DuckDBTypeId.INTEGER);
    assert.equal(duckSchema[1].typeId, DuckDBTypeId.VARCHAR);
  });
});

describe("schemaOf", () => {
  it("returns column names and types", async () => {
    db = await createStagingDb();
    await db.exec(`CREATE TABLE test (id INTEGER, name VARCHAR)`);
    const schema = await db.schemaOf("test");
    assert.equal(schema.length, 2);
    assert.equal(schema[0].name, "id");
    assert.equal(schema[1].name, "name");
  });
});
