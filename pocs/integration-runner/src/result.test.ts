import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertSyncProgress, sourceResultFromSync } from "./result.js";
import { emptySyncResult, type SyncError } from "@integrations/graph/sink.js";

const err = (id: string): SyncError => ({ kind: "upsert", entityType: "t", entityId: id, message: `failed ${id}` });

describe("assertSyncProgress", () => {
  it("passes a clean sync", () => {
    assertSyncProgress("sync:a", { ...emptySyncResult(), inserts: 5 });
  });

  it("passes partial errors with progress", () => {
    assertSyncProgress("sync:a", { ...emptySyncResult(), inserts: 5, errors: [err("x")] });
  });

  it("passes an empty source (no errors, no progress)", () => {
    assertSyncProgress("sync:a", emptySyncResult());
  });

  it("throws on errors with zero progress", () => {
    assert.throws(
      () => assertSyncProgress("sync:a", { ...emptySyncResult(), errors: [err("x")] }),
      /sync:a: no progress -- 1 error\(s\)\. First: x: failed x/,
    );
  });

  it("throws on circuit-breaker abort even with progress", () => {
    assert.throws(
      () => assertSyncProgress("sync:a", { ...emptySyncResult(), inserts: 100, errors: [err("x")], aborted: true }),
      /systemic failure, no writes succeeded/,
    );
  });

  it("requireProgress: false only fails on abort", () => {
    assertSyncProgress("flush-links", { ...emptySyncResult(), errors: [err("x")] }, { requireProgress: false });
    assert.throws(
      () => assertSyncProgress("flush-links", { ...emptySyncResult(), errors: [err("x")], aborted: true }, { requireProgress: false }),
      /systemic failure, no writes succeeded/,
    );
  });
});

describe("sourceResultFromSync", () => {
  it("caps serialized errors", () => {
    const errors = Array.from({ length: 100 }, (_, i) => err(String(i)));
    const result = sourceResultFromSync("a", { ...emptySyncResult(), inserts: 1, errors }, 10);
    assert.equal(result.errors.length, 26);
    assert.match(result.errors[25].message, /and 75 more error\(s\)/);
  });

  it("keeps small error lists intact", () => {
    const result = sourceResultFromSync("a", { ...emptySyncResult(), errors: [err("x")] }, 10);
    assert.equal(result.errors.length, 1);
    assert.equal(result.status, "errors");
  });
});
