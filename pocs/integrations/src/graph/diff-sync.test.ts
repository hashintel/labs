import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDuckDbQueryStore } from "../staging/duckdb.js";
import { diffAndSync } from "./sink.js";
import { namespace, type GraphSinkConfig } from "../transform/pipeline.js";
import type { GraphOp, GraphClient } from "./types.js";
import type { QueryableStore } from "../staging/types.js";

const T = namespace("https://hash.ai/@test/types");

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
