import { Schema, ParseResult, Either } from "effect";

export function decodeRows(
  schema: Schema.Schema.All,
  rows: unknown[],
  stepId: string,
): readonly unknown[] {
  const s = schema as Schema.Schema<unknown>;
  const decode = Schema.decodeUnknownEither(Schema.Array(s), { errors: "all" });
  const result = decode(rows);
  if (Either.isRight(result)) return result.right;
  const formatted = ParseResult.TreeFormatter.formatErrorSync(result.left);
  throw new Error(`Schema validation failed at step "${stepId}":\n${formatted}`);
}
