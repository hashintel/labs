import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DuckDBTypeId } from "@duckdb/node-api";
import { createDuckDbQueryStore } from "./duckdb.js";
import { META_COLUMNS, type QueryableStore } from "./types.js";
import type { ChangeEvent } from "../connector/types.js";

let db: QueryableStore;

afterEach(() => db?.close());

function ev(table: string, op: ChangeEvent["op"], key: Record<string, unknown>, row: Record<string, unknown> | null): ChangeEvent {
  return { table, op, key, row };
}

describe("materialize", () => {
  it("materializes inserts with _op and _key", async () => {
    db = await createDuckDbQueryStore();
    await db.materialize("t", "users", [
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
    db = await createDuckDbQueryStore();
    await db.materialize("t", "users", [ev("users", "update", { id: 1 }, { id: "1", email: "new@b.com" })]);

    const { rows } = await db.query(`SELECT * FROM "t/users"`);
    assert.equal(rows[0][META_COLUMNS.op], "update");
  });

  it("materializes deletes with null data columns", async () => {
    db = await createDuckDbQueryStore();
    await db.materialize("t", "users", [
      ev("users", "insert", { id: 1 }, { id: "1", email: "a@b.com" }),
      ev("users", "delete", { id: 1 }, null),
    ]);

    const { rows } = await db.query(`SELECT * FROM "t/users" WHERE _op = 'delete'`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, null);
  });

  it("handles batch of only deletes", async () => {
    db = await createDuckDbQueryStore();
    await db.materialize("t", "users", [ev("users", "delete", { id: 1 }, null)]);

    const { rows } = await db.query(`SELECT * FROM "t/users"`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][META_COLUMNS.op], "delete");
  });

  it("serializes compound keys as JSON", async () => {
    db = await createDuckDbQueryStore();
    await db.materialize("t", "lines", [
      ev("lines", "insert", { order_id: 1, line_id: 2 }, { order_id: "1", line_id: "2", qty: "5" }),
    ]);

    const { rows } = await db.query(`SELECT * FROM "t/lines"`);
    const key = JSON.parse(rows[0][META_COLUMNS.key] as string);
    assert.equal(key.order_id, 1);
    assert.equal(key.line_id, 2);
  });

  it("handles values with special characters", async () => {
    db = await createDuckDbQueryStore();
    await db.materialize("t", "users", [
      ev("users", "insert", { id: 1 }, { id: "1", name: "O'Malley \"Bob\"", bio: "line1\nline2" }),
    ]);

    const { rows } = await db.query(`SELECT * FROM "t/users"`);
    assert.equal(rows[0].name, "O'Malley \"Bob\"");
    assert.equal(rows[0].bio, "line1\nline2");
  });

  it("additive across batches — preserves schema for delete-only batch", async () => {
    db = await createDuckDbQueryStore();
    await db.materialize("t", "users", [ev("users", "insert", { id: 1 }, { id: "1", email: "a@b.com" })]);
    await db.exec(`DROP TABLE "t/users"`);
    await db.materialize("t", "users", [ev("users", "delete", { id: 1 }, null)]);

    const { rows } = await db.query(`SELECT * FROM "t/users"`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][META_COLUMNS.op], "delete");
    assert.equal(rows[0].email, null);
  });
});

describe("query", () => {
  it("returns duckSchema alongside rows", async () => {
    db = await createDuckDbQueryStore();
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
    db = await createDuckDbQueryStore();
    await db.exec(`CREATE TABLE test (id INTEGER, name VARCHAR)`);
    const schema = await db.schemaOf("test");
    assert.equal(schema.length, 2);
    assert.equal(schema[0].name, "id");
    assert.equal(schema[1].name, "name");
  });
});

describe("document data (nested objects)", () => {
  it("auto-detects objects and stores as JSON columns", async () => {
    db = await createDuckDbQueryStore();
    await db.materialize("t", "users", [ev("users", "insert", { _id: "abc" }, {
      _id: "abc", name: "Alice", address: { city: "NYC", zip: "10001" }, tags: ["admin", "user"],
    })]);

    const { rows } = await db.query(`SELECT * FROM "t/users"`);
    assert.equal(rows[0].name, "Alice");
    assert.ok(String(rows[0].address).includes("NYC"));
  });

  it("SQL step can extract nested fields via JSON operators", async () => {
    db = await createDuckDbQueryStore();
    await db.materialize("t", "users", [ev("users", "insert", { _id: "abc" }, {
      _id: "abc", name: "Alice", address: { city: "NYC", zip: "10001" },
    })]);

    const { rows } = await db.query(`SELECT name, address->>'city' AS city FROM "t/users"`);
    assert.equal(rows[0].city, "NYC");
  });

  it("explicit column metadata overrides auto-detection", async () => {
    db = await createDuckDbQueryStore();
    await db.materialize("t", "docs", [ev("docs", "insert", { id: "1" }, { id: "1", payload: { nested: true } })], [
      { name: "id", type: "text", nullable: false },
      { name: "payload", type: "json", nullable: false, kind: "json" },
    ]);

    const schema = await db.schemaOf("t/docs");
    assert.ok(schema.find((c) => c.name === "payload"));
  });
});
