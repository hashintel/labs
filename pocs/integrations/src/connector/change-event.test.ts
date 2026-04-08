import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pkColumns, extractKey } from "./types.js";

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

describe("extractKey", () => {
  it("extracts single-column key", () => {
    assert.deepEqual(extractKey({ id: 5, name: "alice" }, "id"), { id: 5 });
  });

  it("extracts compound key", () => {
    assert.deepEqual(
      extractKey({ a: 1, b: 2, c: 3 }, ["a", "b"]),
      { a: 1, b: 2 },
    );
  });

  it("returns empty object for null row", () => {
    assert.deepEqual(extractKey(null, "id"), {});
  });

  it("returns empty object for undefined row", () => {
    assert.deepEqual(extractKey(undefined, "id"), {});
  });

  it("returns undefined values for missing columns", () => {
    assert.deepEqual(extractKey({ x: 1 }, "id"), { id: undefined });
  });
});
