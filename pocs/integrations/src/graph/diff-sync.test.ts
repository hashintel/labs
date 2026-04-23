import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDuckDbQueryStore } from "../staging/duckdb.js";
import { diffAndSync as diffAndSyncRaw, emptySyncResult, mergeSyncResults, type SyncResult, type SyncError } from "./sink.js";
import { namespace, type GraphSinkConfig } from "../transform/pipeline.js";
import type { GraphClient, SourceProvenance } from "./types.js";
import type { QueryableStore } from "../staging/types.js";

const T = namespace("https://hash.ai/@test/types");
const prov: SourceProvenance = { type: "integration", loadedAt: "2026-01-01T00:00:00Z", location: { name: "test-connector" } };

const diffAndSync = (
  sinkId: string,
  config: GraphSinkConfig,
  inputTable: string | null,
  connectorId: string,
  db: QueryableStore,
  client: GraphClient,
  partial?: boolean,
) => diffAndSyncRaw(sinkId, config, inputTable, connectorId, db, client, prov, undefined, partial);

const sinkConfig: GraphSinkConfig = {
  entityType: T.entity("user/v/1"),
  entityId: "userId",
  webId: "web-1",
  properties: {
    [T.property("email/v/1")]: "email",
    [T.property("city/v/1")]: "city",
  },
  links: [{
    column: "orgId",
    linkType: T.link("is-member-of/v/1"),
    targetEntityType: T.entity("organization/v/1"),
  }],
};

type Op = { kind: string; entityId?: unknown; archived?: boolean };

function mockClient(): { ops: Op[]; client: GraphClient } {
  const ops: Op[] = [];
  return {
    ops,
    client: {
      async upsertEntity(op) { ops.push({ kind: "upsert", entityId: op.entityId }); },
      async bulkUpsertEntities(inOps) {
        for (const op of inOps) ops.push({ kind: "upsert", entityId: op.entityId });
        return { ok: inOps.map((o) => String(o.entityId)), failed: [] };
      },
      async archiveEntity(op) { ops.push({ kind: "archive", entityId: op.entityId }); },
    },
  };
}

async function seedTable(db: QueryableStore, table: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const colDefs = cols.map((c) => `"${c}" VARCHAR`).join(", ");
  await db.exec(`CREATE OR REPLACE TABLE "${table}" (${colDefs})`);
  for (const row of rows) {
    const vals = cols.map((c) => row[c] == null ? null : String(row[c]));
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    await db.exec(`INSERT INTO "${table}" VALUES (${placeholders})`, vals);
  }
}

describe("diffAndSync", () => {
  let db: QueryableStore;

  beforeEach(async () => { db = await createDuckDbQueryStore(); });
  afterEach(() => db?.close());

  const row = (userId: string, email: string, city: string, orgId: string) => ({
    _op: "snapshot", _key: `{"id":${userId}}`, _before: null,
    userId, email, city, orgId,
  });

  it("first sync: all inserts", async () => {
    await seedTable(db, "output", [row("1", "a@b.com", "NYC", "org-1"), row("2", "c@d.com", "LA", "org-2")]);
    const { client, ops } = mockClient();

    const result = await diffAndSync("write-users", sinkConfig, "output", "crm", db, client);

    assert.equal(result.inserts, 2);
    assert.equal(result.updates, 0);
    assert.equal(result.deletes, 0);
    assert.equal(result.unchanged, 0);
    assert.equal(ops.length, 2);
    assert.equal(ops[0].kind, "upsert");
  });

  it("second sync unchanged: zero graph calls", async () => {
    await seedTable(db, "output", [row("1", "a@b.com", "NYC", "org-1")]);
    const mock1 = mockClient();
    await diffAndSync("write-users", sinkConfig, "output", "crm", db, mock1.client);

    await db.exec(`DROP TABLE "output"`);
    await seedTable(db, "output", [row("1", "a@b.com", "NYC", "org-1")]);
    const mock2 = mockClient();
    const result = await diffAndSync("write-users", sinkConfig, "output", "crm", db, mock2.client);

    assert.equal(result.inserts, 0);
    assert.equal(result.updates, 0);
    assert.equal(result.deletes, 0);
    assert.equal(result.unchanged, 1);
    assert.equal(mock2.ops.length, 0);
  });

  it("detects updates via hash change", async () => {
    await seedTable(db, "output", [row("1", "a@b.com", "NYC", "org-1")]);
    const mock1 = mockClient();
    await diffAndSync("write-users", sinkConfig, "output", "crm", db, mock1.client);

    await db.exec(`DROP TABLE "output"`);
    await seedTable(db, "output", [row("1", "a@b.com", "SF", "org-1")]);
    const mock2 = mockClient();
    const result = await diffAndSync("write-users", sinkConfig, "output", "crm", db, mock2.client);

    assert.equal(result.inserts, 0);
    assert.equal(result.updates, 1);
    assert.equal(result.unchanged, 0);
    assert.equal(mock2.ops.length, 1);
    assert.equal(mock2.ops[0].kind, "upsert");
  });

  it("detects deletes (entity removed from source)", async () => {
    await seedTable(db, "output", [row("1", "a@b.com", "NYC", "org-1"), row("2", "c@d.com", "LA", "org-2")]);
    const mock1 = mockClient();
    await diffAndSync("write-users", sinkConfig, "output", "crm", db, mock1.client);

    await db.exec(`DROP TABLE "output"`);
    await seedTable(db, "output", [row("1", "a@b.com", "NYC", "org-1")]);
    const mock2 = mockClient();
    const result = await diffAndSync("write-users", sinkConfig, "output", "crm", db, mock2.client);

    assert.equal(result.inserts, 0);
    assert.equal(result.deletes, 1);
    assert.equal(result.unchanged, 1);
    assert.equal(mock2.ops.filter((o) => o.kind === "archive").length, 1);
    assert.equal(mock2.ops.find((o) => o.kind === "archive")!.entityId, "2");
  });

  it("partial mode: absent entities are not archived and state is preserved", async () => {
    await seedTable(db, "output", [
      row("1", "a@b.com", "NYC", "org-1"),
      row("2", "c@d.com", "LA", "org-2"),
    ]);
    await diffAndSync("write-users", sinkConfig, "output", "crm", db, mockClient().client);

    // Second sync: only entity 1 is in the window. Partial mode preserves 2 instead of archiving.
    await db.exec(`DROP TABLE "output"`);
    await seedTable(db, "output", [row("1", "a@b.com", "NYC", "org-1")]);
    const partialRun = mockClient();
    const result = await diffAndSync(
      "write-users", sinkConfig, "output", "crm", db, partialRun.client, true,
    );

    assert.equal(result.inserts, 0);
    assert.equal(result.updates, 0);
    assert.equal(result.deletes, 0, "partial mode must not archive absent entities");
    assert.equal(result.unchanged, 2, "both entities are carried as unchanged");
    assert.equal(partialRun.ops.length, 0, "no graph ops when nothing has changed");

    // Third sync (still partial, full overlap): still unchanged, state intact.
    await db.exec(`DROP TABLE "output"`);
    await seedTable(db, "output", [
      row("1", "a@b.com", "NYC", "org-1"),
      row("2", "c@d.com", "LA", "org-2"),
    ]);
    const rerun = mockClient();
    const result2 = await diffAndSync(
      "write-users", sinkConfig, "output", "crm", db, rerun.client, true,
    );
    assert.equal(result2.inserts, 0);
    assert.equal(result2.unchanged, 2);
    assert.equal(rerun.ops.length, 0);
  });

  it("handles empty source (all deleted)", async () => {
    await seedTable(db, "output", [row("1", "a@b.com", "NYC", "org-1")]);
    const mock1 = mockClient();
    await diffAndSync("write-users", sinkConfig, "output", "crm", db, mock1.client);

    const mock2 = mockClient();
    const result = await diffAndSync("write-users", sinkConfig, null, "crm", db, mock2.client);

    assert.equal(result.inserts, 0);
    assert.equal(result.deletes, 1);
    assert.equal(result.unchanged, 0);
    assert.equal(mock2.ops[0].kind, "archive");
  });

  it("detects stale links on FK change in batch mode", async () => {
    await seedTable(db, "output", [row("1", "a@b.com", "NYC", "org-1")]);
    const mock1 = mockClient();
    await diffAndSync("write-users", sinkConfig, "output", "crm", db, mock1.client);

    await db.exec(`DROP TABLE "output"`);
    await seedTable(db, "output", [row("1", "a@b.com", "NYC", "org-2")]);
    const mock2 = mockClient();
    const result = await diffAndSync("write-users", sinkConfig, "output", "crm", db, mock2.client);

    assert.equal(result.updates, 1);
    const archives = mock2.ops.filter((o) => o.kind === "archive");
    assert.equal(archives.length, 1);
    assert.equal(archives[0].entityId, "1::org-1");
  });

  it("rejects duplicate entity ids in the sink input", async () => {
    await seedTable(db, "output", [
      row("1", "a@b.com", "NYC", "org-1"),
      row("1", "a@b.com", "NYC", "org-2"),  // same userId -- developer bug
    ]);
    const { client } = mockClient();
    await assert.rejects(
      () => diffAndSync("write-users", sinkConfig, "output", "crm", db, client),
      (err: Error) => err.message.includes("duplicate rows") && err.message.includes(`"1"`),
    );
  });

  it("isolates failures: succeeded entities advance state; failed ones retry next sync", async () => {
    await seedTable(db, "output", [
      row("1", "a@b.com", "NYC", "org-1"),
      row("2", "c@d.com", "LA", "org-2"),
    ]);

    // Client that fails on entityId "2" only.
    const ops: Op[] = [];
    const flakyClient: GraphClient = {
      async upsertEntity(op) {
        if (op.entityId === "2") throw new Error("simulated graph 500");
        ops.push({ kind: "upsert", entityId: op.entityId });
      },
      async bulkUpsertEntities(inOps) {
        const ok: string[] = [];
        const failed: { op: typeof inOps[number]; error: Error }[] = [];
        for (const op of inOps) {
          if (op.entityId === "2") { failed.push({ op, error: new Error("simulated graph 500") }); continue; }
          ops.push({ kind: "upsert", entityId: op.entityId });
          ok.push(String(op.entityId));
        }
        return { ok, failed };
      },
      async archiveEntity(op) { ops.push({ kind: "archive", entityId: op.entityId }); },
    };

    const result = await diffAndSync("write-users", sinkConfig, "output", "crm", db, flakyClient);
    assert.equal(result.inserts, 2);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].kind, "upsert");
    assert.equal(result.errors[0].entityId, "2");
    assert.match(result.errors[0].message, /simulated graph 500/);
    assert.equal(ops.length, 1, "only the successful upsert should hit the client");
    assert.equal(ops[0].entityId, "1");

    // Retry: success for both. Entity "1" should be unchanged (already in state),
    // entity "2" should re-appear as an insert (state rolled back for the failure).
    await db.exec(`DROP TABLE "output"`);
    await seedTable(db, "output", [
      row("1", "a@b.com", "NYC", "org-1"),
      row("2", "c@d.com", "LA", "org-2"),
    ]);
    const retry = mockClient();
    const result2 = await diffAndSync("write-users", sinkConfig, "output", "crm", db, retry.client);
    assert.equal(result2.inserts, 1, `"2" retries as insert because it was never persisted to state`);
    assert.equal(result2.unchanged, 1);
    assert.equal(result2.errors.length, 0);
    assert.equal(retry.ops.length, 1);
    assert.equal(retry.ops[0].entityId, "2");
  });

  describe("mergeSyncResults", () => {
    const err = (id: string): SyncError => ({ kind: "upsert", entityType: "user/v/1", entityId: id, message: "boom" });
    const a: SyncResult = { inserts: 1, updates: 2, deletes: 0, unchanged: 3, errors: [err("a")], durationMs: 10 };
    const b: SyncResult = { inserts: 0, updates: 1, deletes: 1, unchanged: 0, errors: [err("b")], durationMs: 20 };
    const c: SyncResult = { inserts: 2, updates: 0, deletes: 0, unchanged: 1, errors: [], durationMs: 5 };

    it("empty result on the left is a no-op", () => {
      assert.deepEqual(mergeSyncResults(emptySyncResult(), a), a);
    });

    it("empty result on the right is a no-op", () => {
      assert.deepEqual(mergeSyncResults(a, emptySyncResult()), a);
    });

    it("is associative: fold order doesn't change the result", () => {
      assert.deepEqual(
        mergeSyncResults(mergeSyncResults(a, b), c),
        mergeSyncResults(a, mergeSyncResults(b, c)),
      );
    });

    it("concatenates errors in order", () => {
      const merged = mergeSyncResults(a, b);
      assert.deepEqual(merged.errors.map((e) => e.entityId), ["a", "b"]);
    });
  });

  it("mixed: insert + update + delete + unchanged", async () => {
    await seedTable(db, "output", [
      row("1", "a@b.com", "NYC", "org-1"),
      row("2", "c@d.com", "LA", "org-2"),
      row("3", "e@f.com", "London", "org-1"),
    ]);
    const mock1 = mockClient();
    await diffAndSync("write-users", sinkConfig, "output", "crm", db, mock1.client);

    await db.exec(`DROP TABLE "output"`);
    await seedTable(db, "output", [
      row("1", "a@b.com", "NYC", "org-1"),
      row("2", "c@d.com", "SF", "org-2"),
      row("4", "g@h.com", "Berlin", "org-1"),
    ]);
    const mock2 = mockClient();
    const result = await diffAndSync("write-users", sinkConfig, "output", "crm", db, mock2.client);

    assert.equal(result.unchanged, 1);
    assert.equal(result.updates, 1);
    assert.equal(result.inserts, 1);
    assert.equal(result.deletes, 1);
  });
});
