import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Schema } from "effect";
import { DuckDBTypeId } from "@duckdb/node-api";
import { formatDuckSchema, decodeRows, assertSchemaColumns, assertSchemasCompatible, effectSchemaFromDuck, type DuckSchema } from "./schema.js";

describe("formatDuckSchema", () => {
  it("formats column names and types", () => {
    const schema: DuckSchema = [
      { name: "id", typeId: DuckDBTypeId.INTEGER },
      { name: "name", typeId: DuckDBTypeId.VARCHAR },
    ];
    assert.equal(formatDuckSchema(schema), "id: INTEGER, name: VARCHAR");
  });

  it("returns empty string for empty schema", () => {
    assert.equal(formatDuckSchema([]), "");
  });
});

describe("decodeRows", () => {
  const TestSchema = Schema.Struct({ id: Schema.String, email: Schema.String });

  it("decodes valid rows", () => {
    const decoded = decodeRows(TestSchema, [{ id: "1", email: "a@b.com" }], "s");
    assert.equal(decoded.length, 1);
    assert.equal(decoded[0].id, "1");
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

describe("assertSchemaColumns", () => {
  const UserSchema = Schema.Struct({ id: Schema.String, email: Schema.String });

  it("passes when all columns present", () => {
    const duck: DuckSchema = [
      { name: "id", typeId: DuckDBTypeId.VARCHAR },
      { name: "email", typeId: DuckDBTypeId.VARCHAR },
      { name: "extra", typeId: DuckDBTypeId.VARCHAR },
    ];
    assertSchemaColumns(UserSchema, duck, "s");
  });

  it("throws when column missing", () => {
    const duck: DuckSchema = [{ name: "id", typeId: DuckDBTypeId.VARCHAR }];
    assert.throws(
      () => assertSchemaColumns(UserSchema, duck, "my-step"),
      (err: Error) => err.message.includes("email") && err.message.includes("my-step"),
    );
  });

  it("no-ops for non-struct schemas", () => {
    assertSchemaColumns(Schema.String, [], "s");
  });
});

describe("assertSchemasCompatible", () => {
  it("passes when producer has all columns consumer needs", () => {
    const producer: DuckSchema = [
      { name: "id", typeId: DuckDBTypeId.VARCHAR },
      { name: "email", typeId: DuckDBTypeId.VARCHAR },
      { name: "extra", typeId: DuckDBTypeId.VARCHAR },
    ];
    const consumer = Schema.Struct({ id: Schema.String, email: Schema.String });
    assertSchemasCompatible(producer, consumer, "step-a", "step-b");
  });

  it("throws when producer is missing a column consumer needs", () => {
    const producer: DuckSchema = [{ name: "id", typeId: DuckDBTypeId.VARCHAR }];
    const consumer = Schema.Struct({ id: Schema.String, email: Schema.String });
    assert.throws(
      () => assertSchemasCompatible(producer, consumer, "step-a", "step-b"),
      (err: Error) => err.message.includes("email") && err.message.includes("step-b"),
    );
  });
});

describe("effectSchemaFromDuck", () => {
  it("generates a struct schema from DuckSchema columns", () => {
    const duck: DuckSchema = [
      { name: "id", typeId: DuckDBTypeId.VARCHAR },
      { name: "name", typeId: DuckDBTypeId.VARCHAR },
    ];
    const generated = effectSchemaFromDuck(duck);
    const decoded = Schema.decodeUnknownSync(generated)({ id: "1", name: "alice" });
    assert.equal(decoded.id, "1");
  });

  it("accepts null values", () => {
    const duck: DuckSchema = [{ name: "val", typeId: DuckDBTypeId.VARCHAR }];
    const generated = effectSchemaFromDuck(duck);
    const decoded = Schema.decodeUnknownSync(generated)({ val: null });
    assert.equal(decoded.val, null);
  });
});
