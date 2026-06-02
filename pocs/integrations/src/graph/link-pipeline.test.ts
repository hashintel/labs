import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDuckDbQueryStore } from "../staging/duckdb.js";
import { createLocalStorage } from "../storage/local.js";
import { writeCheckpoint } from "../transform/checkpoint.js";
import { processLinkPipeline } from "./link-pipeline.js";
import { flushGraphLinks } from "./sink.js";
import type { GraphClient, SourceProvenance } from "./types.js";
import type { QueryableStore } from "../staging/types.js";
import type { Storage } from "../storage/types.js";
import type { LinkPipeline } from "../transform/pipeline.js";

let db: QueryableStore;
let root = "";

afterEach(() => {
  db?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

const prov: SourceProvenance = { type: "integration", loadedAt: "2026-01-01T00:00:00Z" };

const link: LinkPipeline = {
  id: "users-orgs",
  source: "users",
  from: { entityType: "https://hash.ai/@t/types/entity-type/user/v/1", column: "user_id" },
  to: { entityType: "https://hash.ai/@t/types/entity-type/org/v/1", column: "org_id" },
  linkType: "https://hash.ai/@t/types/entity-type/member-of/v/1",
  webId: "web-1",
  properties: { "https://hash.ai/@t/types/property-type/role/v/1": "role" },
};

async function setup(): Promise<{ storage: Storage; ops: string[]; client: GraphClient }> {
  root = mkdtempSync(join(tmpdir(), "links-"));
  db = await createDuckDbQueryStore();
  const storage = createLocalStorage({ root: join(root, "staging") });
  const ops: string[] = [];
  const client: GraphClient = {
    async upsertEntity() {},
    async bulkUpsertEntities() { return { ok: [], failed: [], batches: 0, fellBackBatches: 0, durationMs: 0 }; },
    async upsertLink(op) { ops.push(`link:${op.sourceEntityId}->${op.targetId}`); return "ok"; },
    async bulkUpsertLinks(inOps, opts) {
      for (const op of inOps) ops.push(`link:${op.sourceEntityId}->${op.targetId}`);
      const ok = inOps.map((op) => op.opId);
      await opts?.onBatchOk?.(ok);
      return { ok, failed: [], batches: 1, fellBackBatches: 0, durationMs: 0 };
    },
    async archiveEntity(op) { ops.push(`archive:${op.entityId}`); },
  };
  return { storage, ops, client };
}

async function writeUsers(rows: Array<{ user_id: string; org_id: string; role: string }>, storage: Storage): Promise<void> {
  await db.exec(`CREATE OR REPLACE TABLE users_cp (_op VARCHAR, _key VARCHAR, _before VARCHAR, user_id VARCHAR, org_id VARCHAR, role VARCHAR)`);
  for (const row of rows) {
    await db.exec(`INSERT INTO users_cp VALUES ($1, $2, NULL, $3, $4, $5)`, ["snapshot", "{}", row.user_id, row.org_id, row.role]);
  }
  await writeCheckpoint("users", "users_cp", db, storage);
}

async function writeOrgs(rows: Array<{ org_id: string }>, storage: Storage): Promise<void> {
  await db.exec(`CREATE OR REPLACE TABLE orgs_cp (_op VARCHAR, _key VARCHAR, _before VARCHAR, org_id VARCHAR)`);
  for (const row of rows) {
    await db.exec(`INSERT INTO orgs_cp VALUES ($1, $2, NULL, $3)`, ["snapshot", "{}", row.org_id]);
  }
  await writeCheckpoint("orgs", "orgs_cp", db, storage);
}

describe("processLinkPipeline", () => {
  it("joins multiple checkpoint inputs", async () => {
    const { storage, ops, client } = await setup();
    await writeUsers([{ user_id: "u1", org_id: "o1", role: "member" }, { user_id: "u2", org_id: "missing", role: "member" }], storage);
    await writeOrgs([{ org_id: "o1" }], storage);
    const joined: LinkPipeline = {
      ...link,
      id: "users-orgs-join",
      source: undefined,
      inputs: { users: "users", orgs: "orgs" },
      steps: [{ kind: "sql", id: "join-orgs", sql: "SELECT users.user_id, orgs.org_id, users.role FROM users JOIN orgs ON users.org_id = orgs.org_id" }],
    };

    const result = await processLinkPipeline(joined, "crm", db, storage, prov);
    await flushGraphLinks("crm", db, client);

    assert.equal(result.inserts, 1);
    assert.deepEqual(ops, ["link:u1->o1"]);
  });

  it("upserts property changes without archiving the same link", async () => {
    const { storage, ops, client } = await setup();
    await writeUsers([{ user_id: "u1", org_id: "o1", role: "old" }], storage);
    await processLinkPipeline(link, "crm", db, storage, prov);
    await flushGraphLinks("crm", db, client);
    ops.length = 0;

    await writeUsers([{ user_id: "u1", org_id: "o1", role: "new" }], storage);
    const result = await processLinkPipeline(link, "crm", db, storage, prov);
    await flushGraphLinks("crm", db, client);

    assert.equal(result.inserts, 1);
    assert.equal(result.deletes, 0);
    assert.deepEqual(ops, ["link:u1->o1"]);
  });

  it("rejects duplicate source-target pairs", async () => {
    const { storage } = await setup();
    await writeUsers([
      { user_id: "u1", org_id: "o1", role: "a" },
      { user_id: "u1", org_id: "o1", role: "b" },
    ], storage);

    await assert.rejects(
      () => processLinkPipeline(link, "crm", db, storage, prov),
      /duplicate source-target pairs/,
    );
  });
});
