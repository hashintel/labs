/**
 * The constraint AST: the one definition the parser builds, the printer
 * prints, the builder edits and the evaluator reads. `constraints/SPEC.md`
 * gives the grammar and the meaning.
 */

/** A metric expression, as written in a `metrics:` entry. */
export type MetricExpr =
  | { kind: "number"; value: number }
  | { kind: "count"; place: string }
  | { kind: "fired"; transition: string }
  | { kind: "metric"; name: string }
  | { kind: "negate"; operand: MetricExpr }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: MetricExpr; right: MetricExpr };

/** What an atom's left side names: a defined metric, or a primitive read inline. */
export type MetricRef =
  | { kind: "metric"; name: string }
  | { kind: "count"; place: string }
  | { kind: "fired"; transition: string };

export type Comparator = "<" | "<=" | ">" | ">=" | "==" | "!=";

export const COMPARATORS: readonly Comparator[] = ["<", "<=", ">", ">=", "==", "!="];

/** The symbol the builder and the run panel show for each comparator. */
export const COMPARATOR_SYMBOLS: Readonly<Record<Comparator, string>> = {
  "<": "<",
  "<=": "≤",
  ">": ">",
  ">=": "≥",
  "==": "=",
  "!=": "≠",
};

/** The plain meaning of each comparator, for a hover title. */
export const COMPARATOR_MEANINGS: Readonly<Record<Comparator, string>> = {
  "<": "below (<)",
  "<=": "at most (≤)",
  ">": "above (>)",
  ">=": "at least (≥)",
  "==": "equals (=)",
  "!=": "not equal to (≠)",
};

/** A time window on a temporal operator, in the run's time units, both ends included (MTL). */
export type Window = { from: number; to: number };

/**
 * A formula. In the base scope it is a state constraint (true or false at one
 * state) and holds no temporal operator. The playground also accepts the
 * cases beyond the base, flagged as such: a temporal operator nested inside
 * (`always`, `eventually`, `until`, `weak-until` below), and a window on an
 * operator (MTL). `hole` is a slot the builder has not filled yet; a
 * constraint with a hole gets no verdict.
 */
export type StateExpr =
  | { kind: "hole" }
  | { kind: "always" | "eventually"; body: StateExpr; window?: Window }
  | { kind: "until" | "weak-until"; hold: StateExpr; goal: StateExpr; window?: Window }
  | { kind: "atom"; ref: MetricRef; op: Comparator; value: number }
  | { kind: "bool"; value: boolean }
  | { kind: "not"; operand: StateExpr }
  | { kind: "and"; operands: StateExpr[] }
  | { kind: "or"; operands: StateExpr[] }
  | { kind: "implies"; left: StateExpr; right: StateExpr }
  | { kind: "iff"; left: StateExpr; right: StateExpr }
  | { kind: "ite"; cond: StateExpr; then: StateExpr; else?: StateExpr };

export type TemporalOp = "always" | "eventually" | "until" | "weak-until";

/**
 * The top of a constraint: one temporal operator around the whole
 * expression (the base). `now` is a formula with no operator at the top,
 * checked at the first state (beyond the base). A `window` is MTL, beyond
 * the base.
 */
export type Constraint =
  | { op: "now"; body: StateExpr }
  | { op: "always"; body: StateExpr; window?: Window }
  | { op: "eventually"; body: StateExpr; window?: Window }
  | { op: "until" | "weak-until"; hold: StateExpr; goal: StateExpr; window?: Window };

/** The team's keyword for each temporal operator, as the builder shows it. */
export const TEMPORAL_WORDS: Readonly<Record<TemporalOp, string>> = {
  always: "ALWAYS",
  eventually: "EVENTUALLY",
  until: "UNTIL",
  "weak-until": "WEAK UNTIL",
};

/** Every top of a constraint: the temporal operators and `now`. */
export type TopOp = Constraint["op"];

/** The builder's words for each top: the temporal operators, and `now` (checked at the first state). */
export const TOP_WORDS: Readonly<Record<TopOp, string>> = { now: "(no operator)", ...TEMPORAL_WORDS };

export type Verdict = "satisfied" | "violated" | "pending";

/** A whole `constraint.yaml`. */
export type ConstraintDocument = {
  name: string;
  metrics: { name: string; expr: MetricExpr }[];
  constraint: Constraint;
  run: { seed: number; maxSteps: number; maxTime?: number };
};
