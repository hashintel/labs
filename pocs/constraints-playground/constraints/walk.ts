import { formulaOf } from "./formula";
import { printAtomValue, printMetricRef } from "./printer";

import type { Constraint, MetricExpr, MetricRef, StateExpr } from "./ast";

/** Every count, fired or metric reference a metric expression reads. */
export function metricExprRefs(expr: MetricExpr): MetricRef[] {
  switch (expr.kind) {
    case "number":
      return [];
    case "count":
    case "fired":
    case "metric":
      return [expr];
    case "negate":
      return metricExprRefs(expr.operand);
    case "binary":
      return [...metricExprRefs(expr.left), ...metricExprRefs(expr.right)];
  }
}

export type AtomExpr = Extract<StateExpr, { kind: "atom" }>;

/** The atoms of a state expression, in reading order. */
export function stateAtoms(expr: StateExpr): AtomExpr[] {
  switch (expr.kind) {
    case "atom":
      return [expr];
    case "bool":
    case "hole":
      return [];
    case "not":
      return stateAtoms(expr.operand);
    case "always":
    case "eventually":
      return stateAtoms(expr.body);
    case "until":
    case "weak-until":
      return [...stateAtoms(expr.hold), ...stateAtoms(expr.goal)];
    case "and":
    case "or":
      return expr.operands.flatMap(stateAtoms);
    case "implies":
    case "iff":
      return [...stateAtoms(expr.left), ...stateAtoms(expr.right)];
    case "ite":
      return [
        ...stateAtoms(expr.cond),
        ...stateAtoms(expr.then),
        ...(expr.else ? stateAtoms(expr.else) : []),
      ];
  }
}

/** The atoms of a constraint, in reading order, repeats included. */
export function constraintAtoms(constraint: Constraint): AtomExpr[] {
  return stateAtoms(formulaOf(constraint));
}

/** Every reference an atom reads: the left side, then the right side when it is not a number. */
export function atomRefs(atom: Pick<AtomExpr, "ref" | "value">): MetricRef[] {
  return typeof atom.value === "number" ? [atom.ref] : [atom.ref, atom.value];
}

/** An atom as canonical text, which is also its identity. */
export function atomText(atom: AtomExpr): string {
  return `${printMetricRef(atom.ref)} ${atom.op} ${printAtomValue(atom.value)}`;
}
