import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDuckDbQueryStore } from "../staging/duckdb.js";
import type { QueryableStore } from "../staging/types.js";
import type { GraphClient } from "./types.js";
import { checkStateCoherence, collectGraphSinks, type SinkRef } from "./coherence.js";
import { readMeta, writeMeta } from "./state-meta.js";
import { namespace, pipe, sqlStep, graphSinkStep, branch, type GraphSinkConfig, type TablePipeline } from "../transform/pipeline.js";

const T = namespace("https://hash.ai/@test/types");

function client(overrides: Partial<Pick<GraphClient, "identity" | "hasEntity">> = {}): GraphClient {
  const fail = async () => { throw new Error("write not expected"); };
  return {
    upsertEntity: fail, bulkUpsertEntities: fail as never, upsertLink: fail as never,
    bulkUpsertLinks: fail as never, archiveEntity: fail,
    identity: () => "mock:graph",
    hasEntity: async () => true,
    ...overrides,
  };
}

const sinkConfig: GraphSinkConfig = {
  entityType: T.entity("user/v/1"),
  entityId: "id",
  webId: "web-1",
  properties: {},
};
const sinks: SinkRef[] = [{ sinkId: "write-users", config: sinkConfig }];
const SCOPE = { scope: "entity" as const, connectorId: "crm", sinkId: "write-users" };

async function seedStateTable(db: QueryableStore, ids: string[]) {
  await db.exec(`CREATE OR REPLACE TABLE "_state/sync/crm/write-users" (_entity_id VARCHAR, _content_hash VARCHAR)`);
  for (const id of ids) await db.exec(`INSERT INTO "_state/sync/crm/write-users" VALUES ($1, $2)`, [id, "h"]);
}

async function seedFingerprint(db: QueryableStore, graphIdentity = "mock:graph") {
  await writeMeta(db, SCOPE, { hashVersion: null, configHash: null, graphIdentity, webId: "web-1", namespace: "crm" });
}

const check = (db: QueryableStore, c: GraphClient) =>
  checkStateCoherence({ db, client: c, connectorId: "crm", sinks, linkPipelines: [] });

describe("checkStateCoherence", () => {
  let db: QueryableStore;
  beforeEach(async () => { db = await createDuckDbQueryStore(); });
  afterEach(() => { db?.close(); delete process.env.HASH_ALLOW_STATE_MISMATCH; });

  it("cold start: writes the fingerprint and passes", async () => {
    await check(db, client());
    const meta = await readMeta(db, SCOPE);
    assert.equal(meta?.graphIdentity, "mock:graph");
    assert.equal(meta?.webId, "web-1");
    assert.equal(meta?.namespace, "crm");
  });

  it("state without a fingerprint is a hard error", async () => {
    await seedStateTable(db, ["u1"]);
    await assert.rejects(() => check(db, client()), /no fingerprint is recorded/);
  });

  it("graph identity change is a hard error naming both sides", async () => {
    await seedStateTable(db, ["u1"]);
    await seedFingerprint(db, "https://old-graph");
    await assert.rejects(
      () => check(db, client()),
      (err: Error) =>
        err.message.includes(`entity sink "write-users"`) &&
        err.message.includes(`"https://old-graph" vs "mock:graph"`),
    );
  });

  it("webId change is a hard error", async () => {
    await seedStateTable(db, ["u1"]);
    await writeMeta(db, SCOPE, { hashVersion: null, configHash: null, graphIdentity: "mock:graph", webId: "other-web", namespace: "crm" });
    await assert.rejects(() => check(db, client()), /web "other-web" vs "web-1"/);
  });

  it("sentinel probe: all sampled entities absent means wiped graph", async () => {
    await seedStateTable(db, ["u1", "u2", "u3", "u4"]);
    await seedFingerprint(db);
    await assert.rejects(
      () => check(db, client({ hasEntity: async () => false })),
      /sentinel probe: none of 3 sampled entities/,
    );
  });

  it("sentinel probe: one of three present passes (out-of-band deletion tolerated)", async () => {
    await seedStateTable(db, ["u1", "u2", "u3"]);
    await seedFingerprint(db);
    let calls = 0;
    await check(db, client({ hasEntity: async () => ++calls === 2 }));
  });

  it("probe receives composite ids for the sink's web and namespace", async () => {
    await seedStateTable(db, ["u1"]);
    await seedFingerprint(db);
    const seen: string[] = [];
    await check(db, client({ hasEntity: async (id) => { seen.push(id); return true; } }));
    assert.equal(seen.length, 1);
    assert.match(seen[0], /^web-1~[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("HASH_ALLOW_STATE_MISMATCH=1 drops state and proceeds as cold start", async () => {
    await seedStateTable(db, ["u1"]);
    await seedFingerprint(db, "https://old-graph");
    process.env.HASH_ALLOW_STATE_MISMATCH = "1";
    await check(db, client());
    await assert.rejects(() => db.schemaOf("_state/sync/crm/write-users"));
    const meta = await readMeta(db, SCOPE);
    assert.equal(meta?.graphIdentity, "mock:graph");
  });

  it("fingerprint upsert preserves hash-version metadata", async () => {
    await writeMeta(db, SCOPE, { hashVersion: 2, configHash: "abc", graphIdentity: "mock:graph", webId: "web-1", namespace: "crm" });
    await seedStateTable(db, ["u1"]);
    await check(db, client());
    const meta = await readMeta(db, SCOPE);
    assert.equal(meta?.hashVersion, 2);
    assert.equal(meta?.configHash, "abc");
  });
});

describe("collectGraphSinks", () => {
  it("finds sinks nested inside branch steps", () => {
    const pipelines: TablePipeline[] = [{
      source: "users",
      pipeline: pipe("crm/users",
        sqlStep({ id: "s", query: "SELECT * FROM input" }),
        branch("b",
          [graphSinkStep({ id: "sink-a", ...sinkConfig })],
          [sqlStep({ id: "s2", query: "SELECT * FROM input" }), graphSinkStep({ id: "sink-b", ...sinkConfig })],
        ),
      ),
    }];
    assert.deepEqual(collectGraphSinks(pipelines).map((s) => s.sinkId), ["sink-a", "sink-b"]);
  });
});
