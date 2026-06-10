import type { ChangeOp } from "../connector/types.js";

export type ScalarType = "string" | "number" | "boolean" | "json";
export type FieldType = ScalarType | `${ScalarType}?`;
export type SchemaDecl = Record<string, FieldType>;

export type Row = Record<string, unknown>;

/** `_before` is JSON-encoded in streaming mode, null in batch mode. All three columns are required on every step's output. */
export type Envelope = { _op: ChangeOp; _key: string; _before?: string | null };

export type TransformFn = (rows: (Row & Envelope)[]) => (Row & Envelope)[] | Promise<(Row & Envelope)[]>;
export type TransformResolver = (name: string) => TransformFn;

export type VersionedUrl = string;

// Step interfaces with narrow `Deps = readonly []` defaults so factory returns
// preserve their literal `dependsOn` tuples through branch nesting. The wider
// `Step` union below explicitly opts into `readonly string[]` for variance.

export interface SqlStep<
  Id extends string = string,
  Deps extends readonly string[] = readonly [],
> {
  kind: "sql";
  id: Id;
  sql: string;
  output?: SchemaDecl;
  dependsOn?: Deps;
}

export interface FnStep<
  Id extends string = string,
  Deps extends readonly string[] = readonly [],
> {
  kind: "fn";
  id: Id;
  transform: string | TransformFn;
  input?: SchemaDecl;
  output?: SchemaDecl;
  dependsOn?: Deps;
}

export type Accessor = string | ((data: Row) => unknown);

/** Declare at connector- or source-level (see each source spec). Sink-level works but is a last-resort fallback. */
export type ProvenanceConfig = {
  location?: { name?: string; uri?: string; description?: string };
  authors?: string[];
  firstPublished?: string;
  lastUpdated?: string;
};

export type GraphSinkConfig = {
  entityType: VersionedUrl;
  entityId: Accessor;
  webId: string;
  idNamespace?: string;
  properties: Record<VersionedUrl, Accessor>;
  /** Per-property source field name. Appended to the property's provenance `location.name` (`<source>/<field>`) so each value records the field it came from. */
  propertyFields?: Record<VersionedUrl, string>;
  provenance?: ProvenanceConfig;
};

export type LinkPipeline = {
  id: string;
  source?: string;
  inputs?: Record<string, string>;
  steps?: SqlStep<string, readonly string[]>[];
  from: { entityType: VersionedUrl; column: string };
  to: { entityType: VersionedUrl; column: string };
  linkType: VersionedUrl;
  webId: string;
  idNamespace?: string;
  properties?: Record<VersionedUrl, string>;
  provenance?: ProvenanceConfig;
};

export interface GraphSinkStep<
  Id extends string = string,
  Deps extends readonly string[] = readonly [],
> {
  kind: "graph-sink";
  id: Id;
  config: GraphSinkConfig;
  dependsOn?: Deps;
}

export interface BranchStep<
  Id extends string = string,
  Bs extends readonly (readonly unknown[])[] = readonly (readonly Step[])[],
  Deps extends readonly string[] = readonly [],
> {
  kind: "branch";
  id: Id;
  branches: Bs;
  dependsOn?: Deps;
}

/** Identity on data; writes the current state to `Storage` under `name` as Parquet. */
export interface CheckpointStep<
  Id extends string = string,
  Deps extends readonly string[] = readonly [],
> {
  kind: "checkpoint";
  id: Id;
  name: string;
  dependsOn?: Deps;
}

export type Step =
  | SqlStep<string, readonly string[]>
  | FnStep<string, readonly string[]>
  | GraphSinkStep<string, readonly string[]>
  | BranchStep<string, readonly (readonly Step[])[], readonly string[]>
  | CheckpointStep<string, readonly string[]>;

// Pipeline carries:
//  - `Ids`: phantom union of all step ids in the pipeline, set by `pipe()` so
//    the builder can read it directly rather than re-walking the step tree.
//  - `Ss`:  the concrete steps tuple, so the builder's mapped refinement can
//    narrow each step's `dependsOn`.
// Both default to widely-typed values so downstream code (engine, run,
// topology) sees plain `Pipeline` and reads `steps` as `readonly Step[]`.
export type Pipeline<
  Ids extends string = string,
  Ss extends readonly unknown[] = readonly Step[],
> = {
  source: string;
  steps: Ss;
  readonly __ids?: Ids;
};

export type TablePipeline = { source: string; pipeline: Pipeline; dependsOn?: readonly string[] };
export type SideEffectHandler = (step: Step, currentTable: string) => Promise<void>;

// Each factory has overload pairs (with/without `dependsOn`). This prevents
// `Deps` from widening to the constraint upper bound `readonly string[]`
// when the caller omits deps -- TypeScript sometimes ignores the generic
// default inside variadic contexts (e.g. `branch(...)` arguments).

/** `input` is a view of the previous step's output. Must SELECT `_op, _key, _before` (all three envelope columns are required; `_before` may be NULL). */
export function sqlStep<const Id extends string>(opts: {
  id: Id; query: string | { sql: string }; output?: SchemaDecl;
}): SqlStep<Id, readonly []>;
export function sqlStep<const Id extends string, const Deps extends readonly string[]>(opts: {
  id: Id; query: string | { sql: string }; output?: SchemaDecl; dependsOn: Deps;
}): SqlStep<Id, Deps>;
export function sqlStep(opts: {
  id: string; query: string | { sql: string }; output?: SchemaDecl; dependsOn?: readonly string[];
}): SqlStep<string, readonly string[]> {
  const query = typeof opts.query === "string" ? opts.query : opts.query.sql;
  return { kind: "sql", id: opts.id, sql: query, output: opts.output, dependsOn: opts.dependsOn };
}

/** `transform` is either a `(rows) => rows` or a string name resolved via `spec.transforms`. */
export function fnStep<const Id extends string>(opts: {
  id: Id; transform: string | TransformFn; input?: SchemaDecl; output?: SchemaDecl;
}): FnStep<Id, readonly []>;
export function fnStep<const Id extends string, const Deps extends readonly string[]>(opts: {
  id: Id; transform: string | TransformFn; input?: SchemaDecl; output?: SchemaDecl; dependsOn: Deps;
}): FnStep<Id, Deps>;
export function fnStep(opts: {
  id: string; transform: string | TransformFn; input?: SchemaDecl; output?: SchemaDecl; dependsOn?: readonly string[];
}): FnStep<string, readonly string[]> {
  return { kind: "fn", id: opts.id, transform: opts.transform, input: opts.input, output: opts.output, dependsOn: opts.dependsOn };
}

/** `id` names the `_state/sync/{connectorId}/{id}` batch-sync state table; must be stable across runs. */
export function graphSinkStep<const Id extends string>(
  config: GraphSinkConfig & { id: Id },
): GraphSinkStep<Id, readonly []>;
export function graphSinkStep<const Id extends string, const Deps extends readonly string[]>(
  config: GraphSinkConfig & { id: Id; dependsOn: Deps },
): GraphSinkStep<Id, Deps>;
export function graphSinkStep(
  config: GraphSinkConfig & { id: string; dependsOn?: readonly string[] },
): GraphSinkStep<string, readonly string[]> {
  const { id, dependsOn, ...rest } = config;
  return { kind: "graph-sink", id, config: rest, dependsOn };
}

export function checkpoint<const Id extends string>(opts: {
  id: Id; name: string;
}): CheckpointStep<Id, readonly []>;
export function checkpoint<const Id extends string, const Deps extends readonly string[]>(opts: {
  id: Id; name: string; dependsOn: Deps;
}): CheckpointStep<Id, Deps>;
export function checkpoint(opts: {
  id: string; name: string; dependsOn?: readonly string[];
}): CheckpointStep<string, readonly string[]> {
  return { kind: "checkpoint", id: opts.id, name: opts.name, dependsOn: opts.dependsOn };
}

/** Diagonal fan-out: each inner `Step[]` runs against the pre-branch table; the main flow continues unchanged past the branch. */
export function branch<
  const Id extends string,
  const Bs extends readonly (readonly unknown[])[],
>(
  id: Id,
  ...branches: Bs
): BranchStep<Id, Bs, readonly []> {
  return { kind: "branch", id, branches };
}

/** `namespace("http://.../@ns/types").entity("user/v/2")` → full versioned URL. */
export function namespace(base: string) {
  return {
    entity:   (name: string): VersionedUrl => `${base}/entity-type/${name}`,
    property: (name: string): VersionedUrl => `${base}/property-type/${name}`,
    link:     (name: string): VersionedUrl => `${base}/entity-type/${name}`,
  };
}

/** First arg is the materialised DuckDB table (`"crm/users"`) or a Pipeline to extend. */
export function pipe<
  const NewSteps extends readonly Step[],
  InnerIds extends string = never,
  InnerSteps extends readonly unknown[] = readonly [],
>(
  source: string | Pipeline<InnerIds, InnerSteps>,
  ...steps: NewSteps
): Pipeline<InnerIds | IdsInSteps<NewSteps>, readonly [...InnerSteps, ...NewSteps]> {
  const src = typeof source === "string" ? source : source.source;
  const merged = typeof source === "string" ? steps : [...source.steps, ...steps];
  return { source: src, steps: merged } as unknown as Pipeline<InnerIds | IdsInSteps<NewSteps>, readonly [...InnerSteps, ...NewSteps]>;
}

/**
 * Declare the full set of pipelines for an integration. Returns `TablePipeline[]`
 * and constrains `dependsOn` at both levels:
 *   - pipeline-level `dependsOn` references must be other declared `source` names
 *   - each step's `dependsOn` must reference step ids that exist in the set,
 *     including ids inside `branch(...)` sub-pipelines
 */
export function pipelines<
  const Defs extends readonly {
    source: string;
    pipeline: Pipeline;
    dependsOn?: readonly string[];
  }[],
>(
  defs: Defs & readonly {
    source: Defs[number]["source"];
    pipeline: Refined<Defs[number]["pipeline"], AllStepIds<Defs>>;
    dependsOn?: readonly Defs[number]["source"][];
  }[],
): TablePipeline[] {
  return defs as unknown as TablePipeline[];
}

type IdOf<S> =
  S extends BranchStep<infer Id, infer Bs, infer _>
    ? Id | IdsInBranches<Bs>
    : S extends { id: infer Id } ? (Id & string) : never;

type IdsInSteps<Ss> = Ss extends readonly (infer S)[] ? IdOf<S> : never;

type IdsInBranches<Bs> =
  Bs extends readonly (infer Branch)[]
    ? Branch extends readonly Step[] ? IdsInSteps<Branch> : never
    : never;

type AllStepIds<Defs> =
  Defs extends readonly { pipeline: Pipeline<infer Ids, readonly unknown[]> }[] ? Ids : never;

type Refined<P, Ids extends string> =
  P extends { steps: infer Ss } ? Omit<P, "steps"> & { steps: RefineSteps<Ss, Ids> } : P;

type RefineSteps<Ss, Ids extends string> =
  { readonly [K in keyof Ss]: RefineStep<Ss[K], Ids> };

type RefineStep<S, Ids extends string> =
  S extends BranchStep<infer Id, infer Bs, infer _>
    ? Omit<BranchStep<Id, Bs>, "dependsOn" | "branches"> & {
        dependsOn?: readonly Ids[];
        branches: RefineBranches<Bs, Ids>;
      }
    : S extends { dependsOn?: readonly string[] }
      ? Omit<S, "dependsOn"> & { dependsOn?: readonly Ids[] }
      : S;

type RefineBranches<Bs, Ids extends string> =
  { readonly [K in keyof Bs]: Bs[K] extends readonly Step[] ? RefineSteps<Bs[K], Ids> : Bs[K] };
