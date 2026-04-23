import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeProvenance } from "./provenance.js";

const loadedAt = "2026-01-01T00:00:00Z";

describe("composeProvenance", () => {
  it("applies framework defaults when no layer declares anything", () => {
    const p = composeProvenance({ connectorId: "crm", source: "users", loadedAt });
    assert.equal(p.type, "integration");
    assert.equal(p.loadedAt, loadedAt);
    assert.equal(p.location?.name, "crm/users");
    assert.equal(p.location?.uri, undefined);
  });

  it("never sets entityId (reserved for File-entity opt-in)", () => {
    const p = composeProvenance({
      connectorId: "crm",
      source: "users",
      connector: { location: { name: "c" } },
      sourceLevel: { location: { name: "s" } },
      sink: { location: { name: "k" } },
      loadedAt,
    });
    assert.equal(p.entityId, undefined);
  });

  it("source ⋙ connector ⋙ sink per field", () => {
    const base = { connectorId: "c", source: "s", loadedAt };

    const srcWins = composeProvenance({
      ...base,
      connector: { authors: ["A"] },
      sourceLevel: { authors: ["B"] },
      sink: { authors: ["C"] },
    });
    assert.deepEqual(srcWins.authors, ["B"]);

    const connectorWins = composeProvenance({
      ...base,
      connector: { authors: ["A"] },
      sink: { authors: ["C"] },
    });
    assert.deepEqual(connectorWins.authors, ["A"]);

    const sinkFallback = composeProvenance({ ...base, sink: { authors: ["C"] } });
    assert.deepEqual(sinkFallback.authors, ["C"]);

    const noAuthors = composeProvenance(base);
    assert.equal(noAuthors.authors, undefined);
  });

  it("honours firstPublished/lastUpdated (previously dropped)", () => {
    const p = composeProvenance({
      connectorId: "c",
      source: "s",
      sourceLevel: { firstPublished: "2025-01-01T00:00:00Z", lastUpdated: "2025-06-01T00:00:00Z" },
      loadedAt,
    });
    assert.equal(p.firstPublished, "2025-01-01T00:00:00Z");
    assert.equal(p.lastUpdated, "2025-06-01T00:00:00Z");
  });

  it("user-declared location.uri passes through", () => {
    const p = composeProvenance({
      connectorId: "crm",
      source: "users",
      sourceLevel: { location: { uri: "file:///tmp/users.csv" } },
      loadedAt,
    });
    assert.equal(p.location?.uri, "file:///tmp/users.csv");
  });
});
