import { Schema } from "effect";

export type ScalarType = "string" | "number" | "boolean" | "json";
export type FieldType = ScalarType | `${ScalarType}?`;
export type SchemaDecl = Record<string, FieldType>;

export type Row = Record<string, unknown>;
export type Envelope = { _op: string; _key: string };
export type TransformFn = (rows: (Row & Envelope)[]) => (Row & Envelope)[] | Promise<(Row & Envelope)[]>;
export type TransformResolver = (name: string) => TransformFn;

export type SqlStep = { kind: "sql"; id: string; sql: string; output?: SchemaDecl };
export type RefStep = { kind: "ref"; id: string; fn: string; input?: SchemaDecl; output?: SchemaDecl };
export type LambdaStep = { kind: "lambda"; id: string; transform: TransformFn; input?: SchemaDecl; output?: SchemaDecl };

export type Step = SqlStep | RefStep | LambdaStep;
export type SerializableStep = SqlStep | RefStep;

export type Pipeline = { source: string; steps: Step[] };
export type PipelineDef = { source: string; steps: SerializableStep[] };

export function sqlStep(opts: { id: string; query: string | { sql: string }; output?: SchemaDecl }): SqlStep {
  const query = typeof opts.query === "string" ? opts.query : opts.query.sql;
  return { kind: "sql", id: opts.id, sql: query, output: opts.output };
}

export function refStep(opts: { id: string; fn: string; input?: SchemaDecl; output?: SchemaDecl }): RefStep {
  return { kind: "ref", id: opts.id, fn: opts.fn, input: opts.input, output: opts.output };
}

export function lambdaStep<I extends Row = Row, O extends Row = Row>(opts: {
  id: string;
  transform: (rows: (I & Envelope)[]) => (O & Envelope)[] | Promise<(O & Envelope)[]>;
  input?: SchemaDecl;
  output?: SchemaDecl;
}): LambdaStep {
  return { kind: "lambda", id: opts.id, transform: opts.transform as TransformFn, input: opts.input, output: opts.output };
}

function compose<S extends Step>(source: string | { source: string; steps: S[] }, steps: S[]): { source: string; steps: S[] } {
  if (typeof source === "string") return { source, steps };
  return { source: source.source, steps: [...source.steps, ...steps] };
}

export function pipe(source: string | Pipeline, ...steps: Step[]): Pipeline { return compose(source, steps); }
export function pipelineDef(source: string | PipelineDef, ...steps: SerializableStep[]): PipelineDef { return compose(source, steps); }

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
