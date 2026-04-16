import { Schema, ParseResult, Either } from "effect";
import type { ScalarType, SchemaDecl } from "./pipeline.js";

export function decodeRows(
  schema: Schema.Schema.All,
  rows: unknown[],
  stepId: string,
): readonly unknown[] {
  const decode = Schema.decodeUnknownEither(Schema.Array(schema as Schema.Schema<unknown>), { errors: "all" });
  const decoded = decode(rows);
  if (Either.isRight(decoded)) return decoded.right;
  throw new Error(`Schema validation failed at step "${stepId}":\n${ParseResult.TreeFormatter.formatErrorSync(decoded.left)}`);
}

export function toEffectSchema(decl: SchemaDecl): Schema.Schema.All {
  const fields: Record<string, Schema.Schema.All> = {};
  for (const [name, ft] of Object.entries(decl)) {
    const nullable = ft.endsWith("?");
    const scalar = (nullable ? ft.slice(0, -1) : ft) as ScalarType;
    const base = ({ string: Schema.String, number: Schema.Number, boolean: Schema.Boolean, json: Schema.Unknown } as Record<ScalarType, Schema.Schema.All>)[scalar];
    fields[name] = nullable ? Schema.NullOr(base as Schema.Schema<string>) : base;
  }
  return Schema.Struct(fields as Record<string, Schema.Schema<unknown>>);
}

export function assertSchemaDeclColumns(decl: SchemaDecl, columnNames: Set<string>, stepId: string): void {
  const missing = Object.keys(decl).filter((k) => !columnNames.has(k));
  if (missing.length > 0) {
    throw new Error(`Schema validation failed at step "${stepId}": output missing columns [${missing.join(", ")}]`);
  }
}
