import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDuckdbBatchConnector } from "./duckdb-batch.js";
import { materialize } from "./snapshot.js";
import { createDuckDbQueryStore } from "../staging/duckdb.js";
import { createLogger } from "../log.js";
import { nullStorage } from "../storage/null.js";
import type { QueryableStore } from "../staging/types.js";
import type { HydrateContext } from "./types.js";

const silentLog = createLogger("test", "silent");

let store: QueryableStore;
let tmp: string;

afterEach(() => {
  store?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function hydrate(connectorId: string, source: string): Promise<{ rowCount: number; rows: Record<string, unknown>[] }> {
  const connector = createDuckdbBatchConnector({ id: connectorId, sources: SOURCES });
  const stagingTable = `${connectorId}/${source}`;
  const base = { connectorId, source, stagingTable, store, storage: nullStorage(), log: silentLog };
  const ctx: HydrateContext = {
    ...base,
    materialize: (readExpr, opts) => materialize(base, readExpr, opts.primaryKey),
  };
  const { rowCount } = await connector.hydrate(ctx);
  const { rows } = await store.query(`SELECT * FROM "${stagingTable}" ORDER BY _key`);
  return { rowCount, rows };
}

let SOURCES: Parameters<typeof createDuckdbBatchConnector>[0]["sources"];

describe("duckdb-batch connector", () => {
  it("reads CSV via a sql source with meta columns synthesised", async () => {
    store = await createDuckDbQueryStore();
    tmp = mkdtempSync(join(tmpdir(), "duckdb-conn-"));
    const path = join(tmp, "users.csv");
    writeFileSync(path, "id,email\n1,a@b.com\n2,c@d.com\n");

    SOURCES = { users: { kind: "sql", sql: `SELECT * FROM read_csv('${path}')`, primaryKey: "id" } };
    const { rowCount, rows } = await hydrate("t", "users");

    assert.equal(rowCount, 2);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]._op, "snapshot");
    assert.deepEqual(JSON.parse(rows[0]._key as string), { id: 1 });
    assert.equal(rows[0]._before, null);
    assert.equal(rows[0].email, "a@b.com");
  });

  it("preserves native types (does not force VARCHAR)", async () => {
    store = await createDuckDbQueryStore();
    tmp = mkdtempSync(join(tmpdir(), "duckdb-conn-"));
    const path = join(tmp, "nums.csv");
    writeFileSync(path, "id,qty\n1,42\n2,17\n");

    SOURCES = { nums: { kind: "sql", sql: `SELECT * FROM read_csv('${path}')`, primaryKey: "id" } };
    await hydrate("t", "nums");

    const { rows: schema } = await store.query(`DESCRIBE "t/nums"`);
    const qty = schema.find((r) => r.column_name === "qty");
    assert.ok(qty);
    assert.notEqual(String(qty.column_type).toUpperCase(), "VARCHAR");
  });

  it("unions multiple files with differing column sets (union_by_name in user SQL)", async () => {
    store = await createDuckDbQueryStore();
    tmp = mkdtempSync(join(tmpdir(), "duckdb-conn-"));
    const a = join(tmp, "2024.csv");
    const b = join(tmp, "2025.csv");
    writeFileSync(a, "id,amount\n1,100\n");
    writeFileSync(b, "id,amount,currency\n2,200,USD\n");

    SOURCES = {
      ledger: {
        kind: "sql",
        sql: `SELECT * FROM read_csv(['${a}', '${b}'], union_by_name=true)`,
        primaryKey: "id",
      },
    };
    const { rowCount, rows } = await hydrate("t", "ledger");
    assert.equal(rowCount, 2);
    const byKey = Object.fromEntries(rows.map((r) => [JSON.parse(r._key as string).id, r]));
    assert.equal(byKey[1].currency, null);
    assert.equal(byKey[2].currency, "USD");
  });

  it("supports custom delimiters, skip rows, and banner lines via sql", async () => {
    store = await createDuckDbQueryStore();
    tmp = mkdtempSync(join(tmpdir(), "duckdb-conn-"));
    const path = join(tmp, "banner.csv");
    writeFileSync(path, "banner line 1\n|\nbanner line 3\nid|email\n|\n1|a@b.com\n2|c@d.com\n");

    SOURCES = {
      users: {
        kind: "sql",
        sql: `SELECT * FROM read_csv('${path}', delim='|', skip=3, all_varchar=true)`,
        primaryKey: "id",
      },
    };
    const { rowCount } = await hydrate("t", "users");
    assert.equal(rowCount, 3);
  });

  it("errors when source columns collide with meta names", async () => {
    store = await createDuckDbQueryStore();
    tmp = mkdtempSync(join(tmpdir(), "duckdb-conn-"));
    const path = join(tmp, "bad.csv");
    writeFileSync(path, "id,_op\n1,x\n");

    SOURCES = { bad: { kind: "sql", sql: `SELECT * FROM read_csv('${path}')`, primaryKey: "id" } };
    await assert.rejects(
      () => hydrate("t", "bad"),
      (err: Error) => err.message.includes("_op") && err.message.includes("reserved"),
    );
  });

  it("errors when primaryKey references a missing column", async () => {
    store = await createDuckDbQueryStore();
    tmp = mkdtempSync(join(tmpdir(), "duckdb-conn-"));
    const path = join(tmp, "t.csv");
    writeFileSync(path, "x\n1\n");

    SOURCES = { t: { kind: "sql", sql: `SELECT * FROM read_csv('${path}')`, primaryKey: "id" } };
    await assert.rejects(
      () => hydrate("t", "t"),
      (err: Error) => err.message.includes("id") && err.message.includes("missing"),
    );
  });

  it("serializes compound key as JSON object", async () => {
    store = await createDuckDbQueryStore();
    tmp = mkdtempSync(join(tmpdir(), "duckdb-conn-"));
    const path = join(tmp, "lines.csv");
    writeFileSync(path, "order_id,line_id,qty\n10,1,5\n10,2,3\n");

    SOURCES = {
      lines: { kind: "sql", sql: `SELECT * FROM read_csv('${path}')`, primaryKey: ["order_id", "line_id"] },
    };
    const { rows } = await hydrate("t", "lines");
    const key = JSON.parse(rows[0]._key as string);
    assert.equal(key.order_id, 10);
    assert.equal(key.line_id, 1);
  });

  it("inline SQL source (VALUES) works identically to file-backed sql", async () => {
    store = await createDuckDbQueryStore();

    SOURCES = {
      inline: {
        kind: "sql",
        sql: "SELECT 1 AS id, 'alice' AS name UNION ALL SELECT 2, 'bob'",
        primaryKey: "id",
      },
    };
    const { rowCount, rows } = await hydrate("t", "inline");
    assert.equal(rowCount, 2);
    assert.equal(rows[0].name, "alice");
  });

  it("returns rowCount=0 for an empty source", async () => {
    store = await createDuckDbQueryStore();
    tmp = mkdtempSync(join(tmpdir(), "duckdb-conn-"));
    const path = join(tmp, "empty.csv");
    writeFileSync(path, "id,name\n");

    SOURCES = { e: { kind: "sql", sql: `SELECT * FROM read_csv('${path}')`, primaryKey: "id" } };
    const { rowCount, rows } = await hydrate("t", "e");
    assert.equal(rowCount, 0);
    assert.equal(rows.length, 0);
  });

  it("throws for an unknown source", async () => {
    store = await createDuckDbQueryStore();
    SOURCES = { a: { kind: "sql", sql: "SELECT 1 AS id", primaryKey: "id" } };
    await assert.rejects(
      () => hydrate("t", "missing"),
      (err: Error) => err.message.includes("missing") && err.message.includes("Unknown source"),
    );
  });

  it("headerRows resolves column names from data rows (multi-row headers)", async () => {
    store = await createDuckDbQueryStore();
    tmp = mkdtempSync(join(tmpdir(), "duckdb-conn-"));
    const path = join(tmp, "multi.csv");
    writeFileSync(
      path,
      "KEY,DEMAND,DEMAND\n" +
      "Id,Qty,Date\n" +
      "1,10,2026-01-01\n" +
      "2,20,2026-02-01\n",
    );

    SOURCES = {
      demand: {
        kind: "sql",
        sql: `SELECT * FROM read_csv('${path}', header=false, all_varchar=true)`,
        headerRows: [0, 1],
        primaryKey: "KEY_Id",
      },
    };
    const { rowCount, rows } = await hydrate("t", "demand");
    assert.equal(rowCount, 2);
    const cols = Object.keys(rows[0]).filter((c) => !c.startsWith("_"));
    assert.ok(cols.includes("KEY_Id"));
    assert.ok(cols.includes("DEMAND_Qty"));
    assert.ok(cols.includes("DEMAND_Date"));
  });

  it("forwardFill on headerRows propagates merged-cell values across a row", async () => {
    store = await createDuckDbQueryStore();
    tmp = mkdtempSync(join(tmpdir(), "duckdb-conn-"));
    const path = join(tmp, "merged.csv");
    writeFileSync(
      path,
      "KEY,DEMAND,,\n" +
      "Id,Qty,Due,Customer\n" +
      "1,10,2026-01,Acme\n",
    );

    SOURCES = {
      merged: {
        kind: "sql",
        sql: `SELECT * FROM read_csv('${path}', header=false, all_varchar=true)`,
        headerRows: [0, 1],
        forwardFill: true,
        primaryKey: "KEY_Id",
      },
    };
    const { rows } = await hydrate("t", "merged");
    const cols = Object.keys(rows[0]).filter((c) => !c.startsWith("_"));
    assert.ok(cols.includes("DEMAND_Qty"));
    assert.ok(cols.includes("DEMAND_Due"));
    assert.ok(cols.includes("DEMAND_Customer"));
  });

  it("filters rows via WHERE in the user's sql", async () => {
    store = await createDuckDbQueryStore();
    tmp = mkdtempSync(join(tmpdir(), "duckdb-conn-"));
    const path = join(tmp, "mixed.csv");
    writeFileSync(path, "id,email\n1,a@b.com\n2,\n3,c@d.com\n");

    SOURCES = {
      valid: {
        kind: "sql",
        sql: `SELECT * FROM read_csv('${path}') WHERE email IS NOT NULL AND email <> ''`,
        primaryKey: "id",
      },
    };
    const { rowCount, rows } = await hydrate("t", "valid");
    assert.equal(rowCount, 2);
    assert.deepEqual(rows.map((r) => r.email).sort(), ["a@b.com", "c@d.com"]);
  });

  it("fn source delegates to caller code via ctx.materialize", async () => {
    store = await createDuckDbQueryStore();
    SOURCES = {
      custom: {
        kind: "fn",
        primaryKey: "id",
        hydrate: async (ctx) => {
          const readExpr = "SELECT * FROM (VALUES (1, 'a'), (2, 'b')) t(id, v)";
          return ctx.materialize(readExpr, { primaryKey: "id" });
        },
      },
    };
    const { rowCount, rows } = await hydrate("t", "custom");
    assert.equal(rowCount, 2);
    assert.equal(rows[0].v, "a");
    assert.equal(rows[0]._op, "snapshot");
  });
});
