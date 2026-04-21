import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrate } from "../engine.js";
import { pipe, sqlStep, checkpoint, pipelines } from "../transform/pipeline.js";
import { createDuckDbQueryStore } from "../staging/duckdb.js";
import { createMemoryEventStore } from "../staging/memory.js";
import { createLocalStorage } from "../storage/local.js";
import type { QueryableStore } from "../staging/types.js";

let db: QueryableStore;
let root: string;

afterEach(() => {
  db?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("end-to-end cleanup flow", () => {
  it("reads a pipe-delimited multi-row-header file, renames + casts in a pipeline step, checkpoints", async () => {
    root = mkdtempSync(join(tmpdir(), "flow-"));
    const storage = createLocalStorage({ root: join(root, "staging") });
    db = await createDuckDbQueryStore();

    const csvPath = join(root, "items.csv");
    writeFileSync(
      csvPath,
      "|KEY|VALUES|VALUES\n" +
      "|Id|Amount|Qty\n" +
      "|A|1,25|\n" +
      "|B|2,50|7\n",
    );

    await integrate({
      connector: {
        id: "src",
        mode: "batch",
        sources: {
          items: {
            kind: "sql",
            sql: `SELECT * FROM read_csv('${csvPath}', delim='|', header=false, all_varchar=true)`,
            headerRows: [0, 1],
            forwardFill: true,
            primaryKey: "KEY_Id",
          },
        },
      },
      pipelines: pipelines([{
        source: "items",
        pipeline: pipe("src/items",
          sqlStep({
            id: "clean",
            query:
              `SELECT _op, _key, _before, ` +
                `KEY_Id AS id, ` +
                `REPLACE(VALUES_Amount, ',', '.')::DOUBLE AS amount, ` +
                `NULLIF(VALUES_Qty, '')::INTEGER AS qty ` +
              `FROM input`,
          }),
          checkpoint({ id: "cp-out", name: "items-cleaned" }),
        ),
      }] as const),
      eventStore: createMemoryEventStore(),
      queryStore: db,
      storage,
      logLevel: "error",
    }).sync();

    const uri = storage.uriFor("checkpoints/items-cleaned.parquet");
    const { rows } = await db.query(`SELECT id, amount, qty FROM read_parquet('${uri}') ORDER BY id`);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, "A");
    assert.equal(Number(rows[0].amount), 1.25);
    assert.equal(rows[0].qty, null);
    assert.equal(Number(rows[1].amount), 2.5);
    assert.equal(rows[1].qty, 7);
  });
});
