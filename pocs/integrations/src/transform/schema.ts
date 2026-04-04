import { DuckDBTypeId } from "@duckdb/node-api";
import type { DuckDBType } from "@duckdb/node-api";
import { Schema, ParseResult, Either } from "effect";

export type Column = {
  name: string;
  typeId: DuckDBTypeId;
};

export type DuckSchema = Column[];

export function duckSchemaFrom(names: string[], types: DuckDBType[]): DuckSchema {
  return names.map((name, i) => ({ name, typeId: types[i].typeId }));
}

export function formatDuckSchema(schema: DuckSchema): string {
  return schema.map((c) => `${c.name}: ${DuckDBTypeId[c.typeId]}`).join(", ");
}

export function decodeRows<A, I>(
  schema: Schema.Schema<A, I>,
  rows: unknown[],
  stepId: string,
): readonly A[] {
  const decode = Schema.decodeUnknownEither(Schema.Array(schema), { errors: "all" });
  const result = decode(rows);
  if (Either.isRight(result)) return result.right;
  const formatted = ParseResult.TreeFormatter.formatErrorSync(result.left);
  throw new Error(`Schema validation failed at step "${stepId}":\n${formatted}`);
}

export function assertSchemaColumns(
  effectSchema: Schema.Schema<any, any>,
  duckSchema: DuckSchema,
  stepId: string,
): void {
  const actual = new Set(duckSchema.map((c) => c.name));
  const ast = Schema.encodedSchema(effectSchema).ast;
  if (ast._tag !== "TypeLiteral") return;
  const expected = ast.propertySignatures.map((p) => String(p.name));
  const missing = expected.filter((k) => !actual.has(k));
  if (missing.length > 0) {
    throw new Error(`Schema validation failed at step "${stepId}": output missing columns [${missing.join(", ")}]`);
  }
}
