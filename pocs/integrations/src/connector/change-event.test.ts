import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pkColumns, compileKeyExtractor } from "./types.js";

describe("pkColumns", () => {
  it("wraps a string in an array", () => {
    assert.deepEqual(pkColumns("id"), ["id"]);
  });

  it("passes through an array", () => {
    assert.deepEqual(pkColumns(["a", "b"]), ["a", "b"]);
  });

  it("passes through an empty array", () => {
    assert.deepEqual(pkColumns([]), []);
  });
});

describe("compileKeyExtractor", () => {
  it("extracts a single-column key", () => {
    const keyFrom = compileKeyExtractor("id");
    assert.deepEqual(keyFrom({ id: 5, name: "alice" }), { id: 5 });
  });

  it("extracts a compound key", () => {
    const keyFrom = compileKeyExtractor(["a", "b"]);
    assert.deepEqual(keyFrom({ a: 1, b: 2, c: 3 }), { a: 1, b: 2 });
  });

  it("specializes a single-element array like a scalar pk", () => {
    const keyFrom = compileKeyExtractor(["id"]);
    assert.deepEqual(keyFrom({ id: 42 }), { id: 42 });
  });

  it("returns empty for null/undefined rows", () => {
    const keyFrom = compileKeyExtractor("id");
    assert.deepEqual(keyFrom(null), {});
    assert.deepEqual(keyFrom(undefined), {});
  });

  it("returns undefined values for missing columns", () => {
    const keyFrom = compileKeyExtractor("id");
    assert.deepEqual(keyFrom({ x: 1 }), { id: undefined });
  });
});
