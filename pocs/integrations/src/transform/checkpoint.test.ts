import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrate } from "../engine.js";
import { pipe, sqlStep, checkpoint, pipelines } from "./pipeline.js";
import { createDuckDbQueryStore } from "../staging/duckdb.js";
import { createMemoryEventStore } from "../staging/memory.js";
import { createLocalStorage } from "../storage/local.js";
import { nullStorage } from "../storage/null.js";
import type { QueryableStore } from "../staging/types.js";
import type { Storage } from "../storage/types.js";

let db: QueryableStore;
let root: string;

afterEach(() => {
  db?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

function tmp(): { storage: Storage; csvPath: string } {
  root = mkdtempSync(join(tmpdir(), "cp-"));
  const csvPath = join(root, "users.csv");
  writeFileSync(csvPath, "id,email\n1,a@b.com\n2,c@d.com\n");
  return { storage: createLocalStorage({ root: join(root, "staging") }), csvPath };
}

describe("checkpoint", () => {
  it("producer writes a checkpoint parquet with meta + data columns", async () => {
    const { storage, csvPath } = tmp();
    db = await createDuckDbQueryStore();

    const producer = await integrate({
      connector: {
        id: "src",
        mode: "batch",
        sources: { users: { kind: "sql", sql: `SELECT * FROM read_csv('${csvPath}')`, primaryKey: "id" } },
      },
      pipelines: pipelines([{
        source: "users",
        pipeline: pipe("src/users",
          sqlStep({ id: "pass", query: "SELECT _op, _key, _before, id, email FROM input" }),
          checkpoint({ id: "cp-users", name: "users-enriched" }),
        ),
      }] as const),
      eventStore: createMemoryEventStore(),
      queryStore: db,
      storage,
      logLevel: "error",
    }).sync();

    assert.equal(producer.errors.length, 0);
    assert.equal(await storage.exists("checkpoints/users-enriched.parquet"), true);

    const uri = storage.uriFor("checkpoints/users-enriched.parquet");
    const { rows } = await db.query(`SELECT _op, _key, id, email FROM read_parquet('${uri}') ORDER BY id`);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]._op, "snapshot");
    assert.equal(JSON.parse(rows[0]._key as string).id, 1);
    assert.equal(rows[0].email, "a@b.com");
  });

  it("consumer pipeline hydrates from a checkpoint written by a producer", async () => {
    const { storage, csvPath } = tmp();
    db = await createDuckDbQueryStore();

    await integrate({
      connector: {
        id: "src",
        mode: "batch",
        sources: { users: { kind: "sql", sql: `SELECT * FROM read_csv('${csvPath}')`, primaryKey: "id" } },
      },
      pipelines: pipelines([{
        source: "users",
        pipeline: pipe("src/users",
          sqlStep({ id: "p1", query: "SELECT _op, _key, _before, id, email FROM input" }),
          checkpoint({ id: "cp", name: "users-v2" }),
        ),
      }] as const),
      eventStore: createMemoryEventStore(),
      queryStore: db,
      storage,
      logLevel: "error",
    }).sync();

    const consumer = await integrate({
      connector: {
        id: "derived",
        mode: "batch",
        sources: { users: { kind: "checkpoint", name: "users-v2" } },
      },
      pipelines: pipelines([{
        source: "users",
        pipeline: pipe("derived/users",
          sqlStep({ id: "d1", query: "SELECT _op, _key, _before, id, email FROM input" }),
        ),
      }] as const),
      eventStore: createMemoryEventStore(),
      queryStore: db,
      storage,
      logLevel: "error",
    }).sync();

    assert.equal(consumer.errors.length, 0);
  });

  it("consumer hydrate throws when checkpoint is missing", async () => {
    const { storage } = tmp();
    db = await createDuckDbQueryStore();

    const result = await integrate({
      connector: {
        id: "derived",
        mode: "batch",
        sources: { users: { kind: "checkpoint", name: "nonexistent" } },
      },
      pipelines: pipelines([{
        source: "users",
        pipeline: pipe("derived/users",
          sqlStep({ id: "s", query: "SELECT _op, _key, _before FROM input" }),
        ),
      }] as const),
      eventStore: createMemoryEventStore(),
      queryStore: db,
      storage,
      logLevel: "error",
    }).sync();

    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /Checkpoint "nonexistent" not found/);
  });

  it("external source wraps a plain (no-meta) Parquet with snapshot meta columns", async () => {
    const { storage, csvPath } = tmp();
    db = await createDuckDbQueryStore();

    await storage.prepareWrite("inputs/vendor.parquet");
    const uri = storage.uriFor("inputs/vendor.parquet");
    await db.exec(`COPY (SELECT id, email FROM read_csv('${csvPath}')) TO '${uri}' (FORMAT PARQUET)`);

    const result = await integrate({
      connector: {
        id: "ext",
        mode: "batch",
        sources: { vendor: { kind: "external", key: "inputs/vendor.parquet", primaryKey: "id" } },
      },
      pipelines: pipelines([{
        source: "vendor",
        pipeline: pipe("ext/vendor",
          sqlStep({ id: "v1", query: "SELECT _op, _key, _before, id, email FROM input" }),
          checkpoint({ id: "cp-ext", name: "ext-out" }),
        ),
      }] as const),
      eventStore: createMemoryEventStore(),
      queryStore: db,
      storage,
      logLevel: "error",
    }).sync();

    assert.equal(result.errors.length, 0);

    const cpUri = storage.uriFor("checkpoints/ext-out.parquet");
    const { rows } = await db.query(`SELECT _op, _key, email FROM read_parquet('${cpUri}') ORDER BY id`);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]._op, "snapshot");
    assert.equal(JSON.parse(rows[0]._key as string).id, 1);
    assert.equal(rows[0].email, "a@b.com");
  });

  it("external source errors with a clear message when the key is absent", async () => {
    const { storage } = tmp();
    db = await createDuckDbQueryStore();

    const result = await integrate({
      connector: {
        id: "ext",
        mode: "batch",
        sources: { v: { kind: "external", key: "inputs/missing.parquet", primaryKey: "id" } },
      },
      pipelines: pipelines([{
        source: "v",
        pipeline: pipe("ext/v", sqlStep({ id: "s", query: "SELECT _op, _key, _before FROM input" })),
      }] as const),
      eventStore: createMemoryEventStore(),
      queryStore: db,
      storage,
      logLevel: "error",
    }).sync();

    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /External source "inputs\/missing\.parquet" not found/);
  });

  it("throws when a checkpoint step is used but no Storage is supplied", async () => {
    const { csvPath } = tmp();
    db = await createDuckDbQueryStore();

    const result = await integrate({
      connector: {
        id: "src",
        mode: "batch",
        sources: { users: { kind: "sql", sql: `SELECT * FROM read_csv('${csvPath}')`, primaryKey: "id" } },
      },
      pipelines: pipelines([{
        source: "users",
        pipeline: pipe("src/users",
          sqlStep({ id: "pass", query: "SELECT _op, _key, _before, id, email FROM input" }),
          checkpoint({ id: "cp", name: "users-enriched" }),
        ),
      }] as const),
      eventStore: createMemoryEventStore(),
      queryStore: db,
      storage: nullStorage(),
      logLevel: "error",
    }).sync();

    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /No Storage configured/);
  });
});
