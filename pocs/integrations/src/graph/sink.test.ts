import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rowToGraphOp } from "./sink.js";
import { graphSinkStep, namespace, type GraphSinkConfig, type Row, type Envelope } from "../transform/pipeline.js";
import type { SourceProvenance } from "./types.js";

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
    for (const _op of ["update", "upsert", "snapshot"]) {
      const row: Row & Envelope = { _op, _key: "{}", userId: "1", email: "x@example.com", name: "X", orgId: "o" };
      assert.equal(rowToGraphOp(row, config, prov).kind, "upsert");
    }
  });

  it("produces archive for delete — recovers entityId from _key when data is null", () => {
    const row: Row & Envelope = { _op: "delete", _key: '{"userId":"1"}', userId: null, email: null, name: null, orgId: null };
    const op = rowToGraphOp(row, config, prov);
    assert.equal(op.kind, "archive");
    assert.equal(op.entityId, "1");
  });

  it("archive prefers data over _key when both present (CDC with REPLICA IDENTITY FULL)", () => {
    const row: Row & Envelope = { _op: "delete", _key: '{"userId":"old"}', userId: "current", email: null, name: null, orgId: null };
    const op = rowToGraphOp(row, config, prov);
    assert.equal(op.kind, "archive");
    assert.equal(op.entityId, "current");
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
