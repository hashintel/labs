import type { Constraint, StateExpr, Window } from "./ast";

export function withWindow<T extends object>(node: T, window: Window | undefined): T & { window?: Window } {
  return window === undefined ? node : { ...node, window };
}

/** The constraint a formula is: its top temporal operator, or `now` when it has none. */
export function constraintOf(formula: StateExpr): Constraint {
  switch (formula.kind) {
    case "always":
      return withWindow({ op: "always" as const, body: formula.body }, formula.window);
    case "eventually":
      return withWindow({ op: "eventually" as const, body: formula.body }, formula.window);
    case "until":
    case "weak-until":
      return withWindow({ op: formula.kind, hold: formula.hold, goal: formula.goal }, formula.window);
    default:
      return { op: "now", body: formula };
  }
}

/** The whole constraint as one formula: the inverse of `constraintOf`. */
export function formulaOf(constraint: Constraint): StateExpr {
  switch (constraint.op) {
    case "now":
      return constraint.body;
    case "always":
    case "eventually":
      return withWindow({ kind: constraint.op, body: constraint.body }, constraint.window);
    case "until":
    case "weak-until":
      return withWindow({ kind: constraint.op, hold: constraint.hold, goal: constraint.goal }, constraint.window);
  }
}
