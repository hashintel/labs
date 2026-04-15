import { Schema, ParseResult, Either } from "effect";

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
