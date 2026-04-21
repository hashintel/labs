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
import { readMultiRowHeaders } from "./headers.js";
import { writeSnapshot } from "./duckdb-batch.js";
import type { QueryableStore } from "../staging/types.js";

let db: QueryableStore;
let root: string;

afterEach(() => {
  db?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("zero-ingest + multi-row headers + cleanup compose via fn source", () => {
  it("pipe-delimited file with leading-empty col, multi-row headers, European decimals, empty-to-null", async () => {
    root = mkdtempSync(join(tmpdir(), "flow-"));
    const storage = createLocalStorage({ root: join(root, "staging") });
    db = await createDuckDbQueryStore();

    const csvPath = join(root, "items.csv");
    // Leading delimiter produces an empty col; Amount uses European "," decimal; blank qty cells exist.
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
            kind: "fn",
            primaryKey: "id",
            hydrate: async (ctx) => {
              const raw = `SELECT * FROM read_csv('${csvPath}', header=false, delim='|', all_varchar=true)`;
              const named = await readMultiRowHeaders(ctx.store, raw, { rows: [0, 1], forwardFill: true });
              const cleaned =
                `SELECT ` +
                  `KEY_Id AS id, ` +
                  `REPLACE(VALUES_Amount, ',', '.')::DOUBLE AS amount, ` +
                  `NULLIF(VALUES_Qty, '')::INTEGER AS qty ` +
                `FROM (${named})`;
              return await writeSnapshot(ctx, `"${ctx.stagingTable}"`, cleaned, ["id"]);
            },
          },
        },
      },
      pipelines: pipelines([{
        source: "items",
        pipeline: pipe("src/items",
          sqlStep({ id: "pass", query: "SELECT _op, _key, _before, id, amount, qty FROM input" }),
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
