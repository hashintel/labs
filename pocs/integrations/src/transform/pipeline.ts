import { Schema } from "effect";

export type ScalarType = "string" | "number" | "boolean" | "json";
export type FieldType = ScalarType | `${ScalarType}?`;
export type SchemaDecl = Record<string, FieldType>;

export type Row = Record<string, unknown>;
export type Envelope = { _op: string; _key: string };
export type TransformFn = (rows: (Row & Envelope)[]) => (Row & Envelope)[] | Promise<(Row & Envelope)[]>;
export type TransformResolver = (name: string) => TransformFn;

export type VersionedUrl = string;

export type SqlStep = { kind: "sql"; id: string; sql: string; output?: SchemaDecl };

export type FnStep = {
  kind: "fn";
  id: string;
  transform: string | TransformFn;
  input?: SchemaDecl;
  output?: SchemaDecl;
};

export type LinkMapping = {
  column: string;
  sourceColumn?: string;
  linkType: VersionedUrl;
  targetEntityType: VersionedUrl;
};

export type Accessor = string | ((data: Row) => unknown);

export type ProvenanceConfig = {
  location?: { name?: string; uri?: string; description?: string };
  authors?: string[];
};

export type GraphSinkConfig = {
  entityType: VersionedUrl;
  entityId: Accessor;
  webId: string;
  properties: Record<VersionedUrl, Accessor>;
  links?: LinkMapping[];
  provenance?: ProvenanceConfig;
};

export type GraphSinkStep = {
  kind: "graph-sink";
  id: string;
  config: GraphSinkConfig;
};

export type Step = SqlStep | FnStep | GraphSinkStep;
export type Pipeline = { source: string; steps: Step[] };
export type SideEffectHandler = (step: Step, currentTable: string) => Promise<void>;

export function sqlStep(opts: { id: string; query: string | { sql: string }; output?: SchemaDecl }): SqlStep {
  const query = typeof opts.query === "string" ? opts.query : opts.query.sql;
  return { kind: "sql", id: opts.id, sql: query, output: opts.output };
}

export function fnStep(opts: { id: string; transform: string | TransformFn; input?: SchemaDecl; output?: SchemaDecl }): FnStep {
  return { kind: "fn", id: opts.id, transform: opts.transform, input: opts.input, output: opts.output };
}

export function graphSinkStep(config: GraphSinkConfig & { id?: string }): GraphSinkStep {
  return { kind: "graph-sink", id: config.id ?? "graph-sink", config };
}

export function namespace(base: string) {
  return {
    entity:   (name: string): VersionedUrl => `${base}/entity-type/${name}`,
    property: (name: string): VersionedUrl => `${base}/property-type/${name}`,
    link:     (name: string): VersionedUrl => `${base}/entity-type/${name}`,
  };
}

export function pipe(source: string | Pipeline, ...steps: Step[]): Pipeline {
  if (typeof source === "string") return { source, steps };
  return { source: source.source, steps: [...source.steps, ...steps] };
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
