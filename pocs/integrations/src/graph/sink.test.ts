import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rowToGraphOp, archiveDeletes } from "./sink.js";
import { graphSinkStep, namespace, type GraphSinkConfig, type Row, type Envelope } from "../transform/pipeline.js";
import type { GraphClient, GraphOp, SourceProvenance } from "./types.js";
import type { ChangeEvent } from "../connector/types.js";

const T = namespace("https://hash.ai/@test/types");
const prov: SourceProvenance = { type: "integration", loadedAt: "2026-01-01T00:00:00Z", location: { name: "test-connector" } };

const config: GraphSinkConfig = {
  entityType: T.entity("user/v/1"),
  entityId: "userId",
  webId: "web-1",
  properties: {
    [T.property("email/v/1")]: "email",
    [T.property("display-name/v/1")]: "name",
  },
  links: [{
    column: "orgId",
    linkType: T.link("is-member-of/v/1"),
    targetEntityType: T.entity("organization/v/1"),
  }],
};

describe("rowToGraphOp", () => {
  it("produces upsert for insert", () => {
    const row: Row & Envelope = { _op: "insert", _key: '{"id":1}', userId: "1", email: "a@example.com", name: "Alice", orgId: "org-1" };
    const op = rowToGraphOp(row, config, prov);

    assert.equal(op.kind, "upsert");
    assert.equal(op.entityId, "1");
    if (op.kind === "upsert") {
      assert.equal(op.properties[T.property("email/v/1")], "a@example.com");
      assert.equal(op.properties[T.property("display-name/v/1")], "Alice");
      assert.equal(op.links.length, 1);
      assert.equal(op.links[0].targetId, "org-1");
    }
  });

  it("produces upsert for update/upsert/snapshot", () => {
    for (const _op of ["update", "upsert", "snapshot"] as const) {
      const row: Row & Envelope = { _op, _key: "{}", userId: "1", email: "x@example.com", name: "X", orgId: "o" };
      assert.equal(rowToGraphOp(row, config, prov).kind, "upsert");
    }
  });

  it("throws if called with _op=\"delete\" (deletes must bypass the pipeline)", () => {
    const row: Row & Envelope = { _op: "delete", _key: '{"userId":"1"}', userId: null, email: null, name: null, orgId: null };
    assert.throws(
      () => rowToGraphOp(row, config, prov),
      (err: Error) => err.message.includes("delete") && err.message.includes("bypass"),
    );
  });

  it("skips links with null values", () => {
    const row: Row & Envelope = { _op: "insert", _key: "{}", userId: "1", email: "a@example.com", name: "Alice", orgId: null };
    const op = rowToGraphOp(row, config, prov);
    if (op.kind === "upsert") assert.equal(op.links.length, 0);
  });

  it("handles config with no links", () => {
    const noLinks: GraphSinkConfig = { ...config, links: undefined };
    const row: Row & Envelope = { _op: "insert", _key: "{}", userId: "1", email: "a@example.com", name: "Alice", orgId: "o" };
    const op = rowToGraphOp(row, noLinks, prov);
    if (op.kind === "upsert") assert.equal(op.links.length, 0);
  });

  it("carries provenance on every op", () => {
    const row: Row & Envelope = { _op: "insert", _key: "{}", userId: "1", email: "a@example.com", name: "Alice", orgId: "o" };
    const op = rowToGraphOp(row, config, prov);
    assert.equal(op.provenance.type, "integration");
    assert.equal(op.provenance.location?.name, "test-connector");
    assert.equal(op.provenance.loadedAt, "2026-01-01T00:00:00Z");
  });

  it("stamps per-property provenance on each property", () => {
    const row: Row & Envelope = { _op: "insert", _key: "{}", userId: "1", email: "a@example.com", name: "Alice", orgId: "o" };
    const op = rowToGraphOp(row, config, prov);
    if (op.kind !== "upsert") return assert.fail("expected upsert");
    assert.ok(op.propertyProvenance);
    assert.deepEqual(op.propertyProvenance![T.property("email/v/1")], { sources: [prov] });
    assert.deepEqual(op.propertyProvenance![T.property("display-name/v/1")], { sources: [prov] });
  });

  it("stamps per-link-property provenance on each link property", () => {
    const withLinkProps: GraphSinkConfig = {
      ...config,
      links: [{
        column: "orgId",
        linkType: T.link("is-member-of/v/1"),
        targetEntityType: T.entity("organization/v/1"),
        properties: { [T.property("role/v/1")]: "role" },
      }],
    };
    const row: Row & Envelope = { _op: "insert", _key: "{}", userId: "1", email: "a@example.com", name: "Alice", orgId: "o", role: "admin" };
    const op = rowToGraphOp(row, withLinkProps, prov);
    if (op.kind !== "upsert") return assert.fail("expected upsert");
    assert.equal(op.links[0].properties?.[T.property("role/v/1")], "admin");
    assert.deepEqual(op.links[0].propertyProvenance?.[T.property("role/v/1")], { sources: [prov] });
  });

  it("SourceProvenance never carries entityId in v1", () => {
    const row: Row & Envelope = { _op: "insert", _key: "{}", userId: "1", email: "a@example.com", name: "Alice", orgId: "o" };
    const op = rowToGraphOp(row, config, prov);
    assert.equal(op.provenance.entityId, undefined);
  });

  it("supports function accessors", () => {
    const fnConfig: GraphSinkConfig = {
      entityType: T.entity("user/v/1"),
      entityId: (data) => data.userId,
      webId: "web-1",
      properties: {
        [T.property("city/v/1")]: (data) => {
          const addr = JSON.parse(data.address as string);
          return addr.city;
        },
        [T.property("email/v/1")]: "email",
      },
    };
    const row: Row & Envelope = { _op: "insert", _key: "{}", userId: "42", email: "a@example.com", address: '{"city":"NYC","zip":"10001"}' };
    const op = rowToGraphOp(row, fnConfig, prov);

    assert.equal(op.entityId, "42");
    if (op.kind === "upsert") {
      assert.equal(op.properties[T.property("city/v/1")], "NYC");
      assert.equal(op.properties[T.property("email/v/1")], "a@example.com");
    }
  });

  it("detects stale links from _before when FK changes", () => {
    const withSource: GraphSinkConfig = {
      ...config,
      links: [{ column: "orgId", sourceColumn: "org_id", linkType: T.link("is-member-of/v/1"), targetEntityType: T.entity("organization/v/1") }],
    };
    const row: Row & Envelope = {
      _op: "update", _key: '{"id":1}',
      _before: JSON.stringify({ id: 1, org_id: "old-org" }),
      userId: "1", email: "a@example.com", name: "Alice", orgId: "new-org",
    };
    const op = rowToGraphOp(row, withSource, prov);
    assert.equal(op.kind, "upsert");
    if (op.kind === "upsert") {
      assert.equal(op.links.length, 1);
      assert.equal(op.links[0].targetId, "new-org");
      assert.equal(op.staleLinks.length, 1);
      assert.equal(op.staleLinks[0].targetId, "old-org");
    }
  });

  it("no stale links when FK unchanged", () => {
    const row: Row & Envelope = {
      _op: "update", _key: '{"id":1}',
      _before: JSON.stringify({ id: 1, orgId: "org-1" }),
      userId: "1", email: "new@example.com", name: "Alice", orgId: "org-1",
    };
    const op = rowToGraphOp(row, config, prov);
    if (op.kind === "upsert") assert.equal(op.staleLinks.length, 0);
  });

  it("no stale links when _before is absent", () => {
    const row: Row & Envelope = { _op: "update", _key: '{"id":1}', userId: "1", email: "a@example.com", name: "Alice", orgId: "org-1" };
    const op = rowToGraphOp(row, config, prov);
    if (op.kind === "upsert") assert.equal(op.staleLinks.length, 0);
  });
});

describe("archiveDeletes composite-key determinism", () => {
  function recording(): GraphClient & { ops: GraphOp[] } {
    const ops: GraphOp[] = [];
    return {
      ops,
      async upsertEntity(op) { ops.push(op); },
      async bulkUpsertEntities(inOps, opts) { for (const o of inOps) ops.push(o); const okIds = inOps.map((o) => String(o.entityId)); if (opts?.onBatchOk) await opts.onBatchOk(okIds); return { ok: okIds, failed: [], batches: 1, fellBackBatches: 0, durationMs: 0 }; },
      async archiveEntity(op) { ops.push(op); },
    };
  }

  it("entity id is stable under object-key insertion-order variation (composite PK)", async () => {
    const cfg: GraphSinkConfig = { entityType: T.entity("membership/v/1"), entityId: "id", webId: "w", properties: {} };

    const ev1: ChangeEvent = { table: "memberships", op: "delete", key: { tenant: "t1", userId: "u1" }, row: null };
    const ev2: ChangeEvent = { table: "memberships", op: "delete", key: { userId: "u1", tenant: "t1" }, row: null };

    const c1 = recording();
    const c2 = recording();
    await archiveDeletes([ev1], cfg, c1, prov);
    await archiveDeletes([ev2], cfg, c2, prov);

    assert.equal(c1.ops.length, 1);
    assert.equal(c2.ops.length, 1);
    // Alphabetical: tenant < userId, so id is "t1::u1" in both orderings.
    assert.equal(String(c1.ops[0].entityId), "t1::u1");
    assert.equal(String(c2.ops[0].entityId), "t1::u1");
  });

  it("single-key case preserves the raw value type", async () => {
    const cfg: GraphSinkConfig = { entityType: T.entity("user/v/1"), entityId: "id", webId: "w", properties: {} };
    const client = recording();
    await archiveDeletes([{ table: "users", op: "delete", key: { id: 42 }, row: null }], cfg, client, prov);
    assert.equal(client.ops[0].entityId, 42); // number, not "42"
  });
});

describe("GraphSinkStep serialization", () => {
  it("string accessors round-trip through JSON", () => {
    const step = graphSinkStep({ ...config, id: "write-users" });
    const json = JSON.stringify(step);
    const parsed = JSON.parse(json);

    assert.equal(parsed.kind, "graph-sink");
    assert.equal(parsed.config.entityId, "userId");
    assert.equal(parsed.config.properties[T.property("email/v/1")], "email");
    assert.equal(parsed.config.links[0].column, "orgId");
  });

  it("function accessors are dropped by JSON.stringify", () => {
    const fnConfig: GraphSinkConfig = {
      ...config,
      entityId: (data) => data.userId,
      properties: { [T.property("x/v/1")]: (data) => data.x },
    };
    const step = graphSinkStep({ ...fnConfig, id: "fn-sink" });
    const parsed = JSON.parse(JSON.stringify(step));
    assert.equal(parsed.config.entityId, undefined);
    assert.equal(parsed.config.properties[T.property("x/v/1")], undefined);
  });
});
