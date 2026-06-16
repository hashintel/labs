import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rowToGraphOp } from "./sink.js";
import { namespace, type GraphSinkConfig, type Row, type Envelope } from "../transform/pipeline.js";
import type { SourceProvenance } from "./types.js";

const T = namespace("https://hash.ai/@h/types");
const base: SourceProvenance = {
  type: "integration",
  loadedAt: "2026-01-01T00:00:00Z",
  location: { name: "sap/vbak" },
};

const config: GraphSinkConfig = {
  entityType: T.entity("sales-order/v/1"),
  entityId: "id",
  webId: "web-1",
  properties: { [T.property("order-type/v/1")]: "orderType" },
  provenanceFields: {
    // firstPublished returns a date-only string (like the runner's `date` coercion),
    // which applyProvenanceFields promotes to RFC3339.
    authors: "createdBy",
    firstPublished: (r) => {
      const v = r.createdOn;
      return v == null || String(v).trim() === "" ? null : String(v);
    },
  },
};

const row = (extra: Record<string, unknown>): Row & Envelope =>
  ({ _op: "snapshot", _key: "{}", _before: null, id: "1", orderType: "OR", ...extra });

describe("per-row provenance (provenanceFields)", () => {
  it("overlays created-by and created-on from the row onto the op provenance", () => {
    const op = rowToGraphOp(row({ createdBy: "ALICE", createdOn: "2025-03-15" }), config, "sap", base);
    assert.deepEqual(op.provenance.authors, ["ALICE"]);
    assert.equal(op.provenance.firstPublished, "2025-03-15T00:00:00Z");
    assert.equal(op.provenance.location?.name, "sap/vbak");
    assert.equal(op.provenance.loadedAt, "2026-01-01T00:00:00Z");
    assert.deepEqual(op.propertyProvenance?.[T.property("order-type/v/1")].sources[0].authors, ["ALICE"]);
  });

  it("skips blank/missing audit columns", () => {
    const op = rowToGraphOp(row({ createdBy: "  ", createdOn: undefined }), config, "sap", base);
    assert.equal(op.provenance.authors, undefined);
    assert.equal(op.provenance.firstPublished, undefined);
  });

  it("is a no-op when no provenanceFields are configured", () => {
    const { provenanceFields, ...withoutFields } = config;
    const op = rowToGraphOp(row({ createdBy: "ALICE" }), withoutFields, "sap", base);
    assert.equal(op.provenance.authors, undefined);
    assert.equal(op.provenance, base);
  });
});
