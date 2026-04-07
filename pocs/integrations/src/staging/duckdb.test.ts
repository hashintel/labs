import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DuckDBTypeId } from "@duckdb/node-api";
import { createDuckDbStaging, type DuckDbStaging } from "./duckdb.js";
import { META_COLUMNS } from "./types.js";
import type { ChangeEvent } from "../connector/types.js";

let db: DuckDbStaging;

afterEach(() => db?.close());

function ev(table: string, op: ChangeEvent["op"], key: Record<string, unknown>, row: Record<string, unknown> | null): ChangeEvent {
  return { table, op, key, row };
}

async function appendAndMaterialize(db: DuckDbStaging, connectorId: string, events: ChangeEvent[]) {
  await db.append(connectorId, events[0].table, events);
  return db.materialize(connectorId, events[0].table);
}

describe("append + materialize", () => {
  it("materializes inserts with _op and _key", async () => {
    db = await createDuckDbStaging();
    await appendAndMaterialize(db, "t", [
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
    db = await createDuckDbStaging();
    await appendAndMaterialize(db, "t", [
      ev("users", "update", { id: 1 }, { id: "1", email: "new@b.com" }),
    ]);

    const { rows } = await db.query(`SELECT * FROM "t/users"`);
    assert.equal(rows[0][META_COLUMNS.op], "update");
  });

  it("materializes deletes with null data columns", async () => {
    db = await createDuckDbStaging();
    await db.append("t", "users", [
      ev("users", "insert", { id: 1 }, { id: "1", email: "a@b.com" }),
      ev("users", "delete", { id: 1 }, null),
    ]);
    await db.materialize("t", "users");

    const { rows } = await db.query(`SELECT * FROM "t/users" WHERE _op = 'delete'`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, null);
  });

  it("handles batch of only deletes", async () => {
    db = await createDuckDbStaging();
    await appendAndMaterialize(db, "t", [ev("users", "delete", { id: 1 }, null)]);

    const { rows } = await db.query(`SELECT * FROM "t/users"`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][META_COLUMNS.op], "delete");
  });

  it("append with empty events is a no-op", async () => {
    db = await createDuckDbStaging();
    const result = await db.append("t", "users", []);
    assert.equal(result.seq, 0);
  });

  it("serializes compound keys as JSON", async () => {
    db = await createDuckDbStaging();
    await appendAndMaterialize(db, "t", [
      ev("lines", "insert", { order_id: 1, line_id: 2 }, { order_id: "1", line_id: "2", qty: "5" }),
    ]);

    const { rows } = await db.query(`SELECT * FROM "t/lines"`);
    const key = JSON.parse(rows[0][META_COLUMNS.key] as string);
    assert.equal(key.order_id, 1);
    assert.equal(key.line_id, 2);
  });

  it("handles values with special characters", async () => {
    db = await createDuckDbStaging();
    await appendAndMaterialize(db, "t", [
      ev("users", "insert", { id: 1 }, { id: "1", name: "O'Malley \"Bob\"", bio: "line1\nline2" }),
    ]);

    const { rows } = await db.query(`SELECT * FROM "t/users"`);
    assert.equal(rows[0].name, "O'Malley \"Bob\"");
    assert.equal(rows[0].bio, "line1\nline2");
  });

  it("materialize with fromSeq skips earlier events", async () => {
    db = await createDuckDbStaging();
    await db.append("t", "users", [
      ev("users", "insert", { id: 1 }, { id: "1", email: "a@b.com" }),
      ev("users", "insert", { id: 2 }, { id: "2", email: "c@d.com" }),
    ]);
    await db.materialize("t", "users", 1);

    const { rows } = await db.query(`SELECT * FROM "t/users"`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, "c@d.com");
  });

  it("returns nextSeq for incremental reads", async () => {
    db = await createDuckDbStaging();
    await db.append("t", "users", [
      ev("users", "insert", { id: 1 }, { id: "1", email: "a@b.com" }),
      ev("users", "insert", { id: 2 }, { id: "2", email: "c@d.com" }),
    ]);
    const r1 = await db.materialize("t", "users");
    assert.equal(r1.nextSeq, 2);
    assert.equal(r1.rowCount, 2);

    await db.append("t", "users", [
      ev("users", "insert", { id: 3 }, { id: "3", email: "e@f.com" }),
    ]);
    const r2 = await db.materialize("t", "users", r1.nextSeq);
    assert.equal(r2.nextSeq, 3);
    assert.equal(r2.rowCount, 1);
  });
});

describe("query", () => {
  it("returns duckSchema alongside rows", async () => {
    db = await createDuckDbStaging();
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
    db = await createDuckDbStaging();
    await db.exec(`CREATE TABLE test (id INTEGER, name VARCHAR)`);
    const schema = await db.schemaOf("test");
    assert.equal(schema.length, 2);
    assert.equal(schema[0].name, "id");
    assert.equal(schema[1].name, "name");
  });
});
