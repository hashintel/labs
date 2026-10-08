import { atomRefs, atomText, constraintAtoms, metricExprRefs } from "../../constraints/walk";

import type { AtomExpr } from "../../constraints/walk";
import type { Comparator, Constraint, ConstraintDocument, MetricRef } from "../../constraints/ast";
import type { TextRange } from "../editor/line-decorations";

type Condition = Pick<AtomExpr, "ref" | "op" | "value">;

/** The places and transitions a condition reads, once each. */
export type NetReads = { places: string[]; transitions: string[] };

/**
 * What a hover on a condition lights: the conditions (by `atomText`), the
 * net items they read, and where to find them. `NO_LINK` is no hover.
 */
export type ResolvedLink = {
  keys: string[];
  atoms: AtomExpr[];
  places: string[];
  transitions: string[];
};

export const NO_LINK: ResolvedLink = { keys: [], atoms: [], places: [], transitions: [] };

/** The primitives a reference reads: a count reads its place, `fired` its transition, a metric what its definition reads. */
function readsOf(ref: MetricRef, metrics: ConstraintDocument["metrics"], seen: Set<string>, into: NetReads): void {
  switch (ref.kind) {
    case "count":
      into.places.push(ref.place);
      return;
    case "fired":
      into.transitions.push(ref.transition);
      return;
    case "metric": {
      const definition = metrics.find((metric) => metric.name === ref.name);
      if (definition === undefined || seen.has(ref.name)) {
        return;
      }
      seen.add(ref.name);
      for (const inner of metricExprRefs(definition.expr)) {
        readsOf(inner, metrics, seen, into);
      }
    }
  }
}

/** The places and transitions the conditions read, resolving a metric through its definition to its `count()` and `fired()` references. */
export function conditionReads(conditions: readonly Pick<AtomExpr, "ref" | "value">[], metrics: ConstraintDocument["metrics"]): NetReads {
  const into: NetReads = { places: [], transitions: [] };
  for (const condition of conditions) {
    for (const ref of atomRefs(condition)) {
      readsOf(ref, metrics, new Set(), into);
    }
  }
  return { places: [...new Set(into.places)], transitions: [...new Set(into.transitions)] };
}

/** The conditions of a constraint that compare the named metric, as `atomText` keys, once each. */
export function conditionsOnMetric(constraint: Constraint, metric: string): string[] {
  const keys = constraintAtoms(constraint)
    .filter((atom) => atom.ref.kind === "metric" && atom.ref.name === metric)
    .map(atomText);
  return [...new Set(keys)];
}

/** The link of the conditions with these keys: the conditions found in the constraint, and what they read. */
export function resolveLink(constraint: Constraint, keys: readonly string[], metrics: ConstraintDocument["metrics"]): ResolvedLink {
  const wanted = new Set(keys);
  const seen = new Set<string>();
  const atoms = constraintAtoms(constraint).filter((atom) => {
    const key = atomText(atom);
    if (!wanted.has(key) || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return { keys: atoms.map(atomText), atoms, ...conditionReads(atoms, metrics) };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** A reference as written in either text: `count( Queue )` and `count(Queue)` both match. */
function refPattern(ref: MetricRef): string {
  switch (ref.kind) {
    case "metric":
      return escapeRegExp(ref.name);
    case "count":
      return `count\\s*\\(\\s*${escapeRegExp(ref.place)}\\s*\\)`;
    case "fired":
      return `fired\\s*\\(\\s*${escapeRegExp(ref.transition)}\\s*\\)`;
  }
}

/** The comparator as the file writes it (ASCII) or the math view does (symbol). */
const COMPARATOR_PATTERNS: Readonly<Record<Comparator, string>> = {
  "<": "<",
  "<=": "<=|≤",
  ">": ">",
  ">=": ">=|≥",
  "==": "==|=",
  "!=": "!=|≠",
};

/**
 * Where a condition is written in a text, in the file's words or the math
 * view's: `Waiting <= 5` and `Waiting ≤ 5`. Spacing is free. A match is one
 * line; the range is in 1-based columns, the end excluded.
 */
export function conditionRanges(text: string, condition: Condition): TextRange[] {
  const pattern = new RegExp(
    `(?<![\\w.])${refPattern(condition.ref)}\\s*(?:${COMPARATOR_PATTERNS[condition.op]})\\s*${typeof condition.value === "number" ? escapeRegExp(String(condition.value)) : refPattern(condition.value)}(?![\\w.])`,
    "gu",
  );
  return text.split("\n").flatMap((line, at) =>
    [...line.matchAll(pattern)].map((match) => ({ line: at + 1, start: match.index + 1, end: match.index + match[0].length + 1 })),
  );
}
