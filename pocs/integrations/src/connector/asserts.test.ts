import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDuckDbQueryStore } from "../staging/duckdb.js";
import type { QueryableStore } from "../staging/types.js";
import { runSourceAsserts } from "./asserts.js";

describe("runSourceAsserts", () => {
  let db: QueryableStore;

  beforeEach(async () => {
    db = await createDuckDbQueryStore();
    await db.exec(`CREATE TABLE "t" (id VARCHAR, plant VARCHAR, qty VARCHAR)`);
    await db.exec(`INSERT INTO "t" VALUES ('1', 'A', '10'), ('2', 'B', NULL), ('3', '  ', '30'), ('3', 'C', '40')`);
  });
  afterEach(() => db?.close());

  it("passes when all asserts hold", async () => {
    await runSourceAsserts(db, "t", "t", { rowCount: { min: 1, max: 10 }, notNull: ["id"] }, 4);
  });

  it("fails rowCount min, including on an empty source", async () => {
    await assert.rejects(
      () => runSourceAsserts(db, "t", "t", { rowCount: { min: 5 } }, 4),
      /rowCount: 4 < min 5/,
    );
    await assert.rejects(
      () => runSourceAsserts(db, "missing", "empty-src", { rowCount: { min: 1 } }, 0),
      /source "empty-src" failed asserts[\s\S]*rowCount: 0 < min 1/,
    );
  });

  it("fails rowCount max", async () => {
    await assert.rejects(() => runSourceAsserts(db, "t", "t", { rowCount: { max: 2 } }, 4), /rowCount: 4 > max 2/);
  });

  it("notNull counts NULL and blank as missing", async () => {
    await assert.rejects(
      () => runSourceAsserts(db, "t", "t", { notNull: ["plant", "qty"] }, 4),
      (err: Error) => /notNull\(plant\): 1 of 4/.test(err.message) && /notNull\(qty\): 1 of 4/.test(err.message),
    );
  });

  it("unique reports offending keys, single and composite", async () => {
    await assert.rejects(
      () => runSourceAsserts(db, "t", "t", { unique: ["id"] }, 4),
      /unique\(id\): duplicated keys, e\.g\. 3 \(2 rows\)/,
    );
    await runSourceAsserts(db, "t", "t", { unique: [["id", "plant"]] }, 4);
  });

  it("skips table scans when the source is empty", async () => {
    await runSourceAsserts(db, "does-not-exist", "t", { notNull: ["id"], unique: ["id"] }, 0);
  });
});
