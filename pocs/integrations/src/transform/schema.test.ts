import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Schema } from "effect";
import { decodeRows } from "./schema.js";

describe("decodeRows", () => {
  const TestSchema = Schema.Struct({ id: Schema.String, email: Schema.String });

  it("decodes valid rows", () => {
    const decoded = decodeRows(TestSchema, [{ id: "1", email: "a@b.com" }], "s");
    assert.equal(decoded.length, 1);
    assert.equal((decoded[0] as Record<string, unknown>).id, "1");
  });

  it("throws with step id in error for invalid rows", () => {
    assert.throws(
      () => decodeRows(TestSchema, [{ id: "1" }], "my-step"),
      (err: Error) => err.message.includes("my-step"),
    );
  });

  it("passes empty array", () => {
    assert.equal(decodeRows(TestSchema, [], "s").length, 0);
  });
});
