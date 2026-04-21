import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMultiRowHeaders } from "./headers.js";
import { createDuckDbQueryStore } from "../staging/duckdb.js";
import type { QueryableStore } from "../staging/types.js";

let db: QueryableStore;
let tmp: string;

afterEach(() => {
  db?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function csvFile(contents: string): string {
  tmp = mkdtempSync(join(tmpdir(), "hdr-"));
  const path = join(tmp, "data.csv");
  writeFileSync(path, contents);
  return path;
}

describe("readMultiRowHeaders", () => {
  it("combines three header rows into single column names", async () => {
    db = await createDuckDbQueryStore();
    const path = csvFile(
      "KEY,DEMAND,DEMAND,DEMAND\n" +
      "Part,Quantity,Due,Customer\n" +
      "Id,Qty,Date,Name\n" +
      "A,5,2026-01-01,Acme\n" +
      "B,7,2026-02-01,Globex\n",
    );
    const expr = await readMultiRowHeaders(
      db,
      `SELECT * FROM read_csv('${path}', header=false, all_varchar=true)`,
      { rows: [0, 1, 2] },
    );
    const { rows, columns } = await db.query(expr);
    assert.deepEqual(columns, ["KEY_Part_Id", "DEMAND_Quantity_Qty", "DEMAND_Due_Date", "DEMAND_Customer_Name"]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].DEMAND_Quantity_Qty, "5");
  });

  it("forwardFill propagates the most recent non-empty value across a row (merged cells)", async () => {
    db = await createDuckDbQueryStore();
    const path = csvFile(
      "KEY,DEMAND,,\n" +                     // row 0: merged group header over 3 cols -> forward-fills
      "Part,Quantity,Due,Customer\n" +
      "1,10,2026-01-01,Acme\n",
    );
    const expr = await readMultiRowHeaders(
      db,
      `SELECT * FROM read_csv('${path}', header=false, all_varchar=true)`,
      { rows: [0, 1], forwardFill: true },
    );
    const { columns } = await db.query(expr);
    assert.deepEqual(columns, ["KEY_Part", "DEMAND_Quantity", "DEMAND_Due", "DEMAND_Customer"]);
  });

  it("deduplicates combined names that collide", async () => {
    db = await createDuckDbQueryStore();
    const path = csvFile(
      "total,total\n" +
      "1,2\n",
    );
    const expr = await readMultiRowHeaders(
      db,
      `SELECT * FROM read_csv('${path}', header=false, all_varchar=true)`,
      { rows: [0] },
    );
    const { columns } = await db.query(expr);
    assert.deepEqual(columns, ["total", "total_2"]);
  });

  it("drops columns with an empty combined name by default", async () => {
    db = await createDuckDbQueryStore();
    const path = csvFile(
      "id,,name\n" +
      "1,x,alice\n",
    );
    const expr = await readMultiRowHeaders(
      db,
      `SELECT * FROM read_csv('${path}', header=false, all_varchar=true)`,
      { rows: [0] },
    );
    const { rows, columns } = await db.query(expr);
    assert.deepEqual(columns, ["id", "name"]);
    assert.equal(rows[0].name, "alice");
  });

  it("custom combine() controls the final name", async () => {
    db = await createDuckDbQueryStore();
    const path = csvFile(
      "Group A,Group A,Group B\n" +
      "qty,due,customer\n" +
      "1,2026,Acme\n",
    );
    const expr = await readMultiRowHeaders(
      db,
      `SELECT * FROM read_csv('${path}', header=false, all_varchar=true)`,
      {
        rows: [0, 1],
        forwardFill: true,
        combine: (parts) => parts.filter(Boolean).map((s) => s.toLowerCase().replace(/\s+/g, "")).join("."),
      },
    );
    const { columns } = await db.query(expr);
    assert.deepEqual(columns, ["groupa.qty", "groupa.due", "groupb.customer"]);
  });

  it("composes with an fn source to land rows with meta columns", async () => {
    db = await createDuckDbQueryStore();
    const path = csvFile(
      "KEY,VALUES,VALUES\n" +
      "id,qty,due\n" +
      "1,10,2026-01\n" +
      "2,20,2026-02\n",
    );
    const readExpr = await readMultiRowHeaders(
      db,
      `SELECT * FROM read_csv('${path}', header=false, all_varchar=true)`,
      { rows: [0, 1], forwardFill: true },
    );
    await db.exec(
      `CREATE OR REPLACE TABLE "demand/raw" AS ` +
      `SELECT 'snapshot' AS _op, to_json({id: KEY_id})::VARCHAR AS _key, CAST(NULL AS JSON) AS _before, * ` +
      `FROM (${readExpr})`,
    );
    const { rows } = await db.query(`SELECT _op, _key, KEY_id, VALUES_qty FROM "demand/raw" ORDER BY KEY_id`);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]._op, "snapshot");
    assert.equal(JSON.parse(rows[0]._key as string).id, "1");
    assert.equal(rows[0].VALUES_qty, "10");
  });
});
