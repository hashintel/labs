import { formulaOf } from "./formula";

import type { Comparator, Constraint, MetricExpr, MetricRef, StateExpr, Window } from "./ast";

/**
 * Canonical text for an AST: word style for temporal operators and logic,
 * ASCII comparators, brackets whenever and/or mix, minimal brackets
 * otherwise. `parse(print(ast))` gives the AST back. `printMath` writes the
 * same AST in math notation.
 */

export function printMetricRef(ref: MetricRef): string {
  switch (ref.kind) {
    case "metric":
      return ref.name;
    case "count":
      return `count(${ref.place})`;
    case "fired":
      return `fired(${ref.transition})`;
  }
}

/** Binding strength of a metric expression: higher binds tighter. */
function metricLevel(expr: MetricExpr): number {
  switch (expr.kind) {
    case "binary":
      return expr.op === "+" || expr.op === "-" ? 1 : 2;
    case "negate":
      return 3;
    default:
      return 4;
  }
}

function printMetricAt(expr: MetricExpr, minLevel: number): string {
  const text = printMetricBare(expr);
  return metricLevel(expr) < minLevel ? `(${text})` : text;
}

function printMetricBare(expr: MetricExpr): string {
  switch (expr.kind) {
    case "number":
      return String(expr.value);
    case "count":
    case "fired":
    case "metric":
      return printMetricRef(expr);
    case "negate":
      return `-${printMetricAt(expr.operand, 3)}`;
    case "binary": {
      const level = metricLevel(expr);
      return `${printMetricAt(expr.left, level)} ${expr.op} ${printMetricAt(expr.right, level + 1)}`;
    }
  }
}

export function printMetricExpr(expr: MetricExpr): string {
  return printMetricBare(expr);
}

/**
 * Binding strength of a state expression in word style: higher binds tighter.
 * Infix until binds loosest, so it prints bare only at the top of a bracket
 * group.
 */
function stateLevel(expr: StateExpr): number {
  switch (expr.kind) {
    case "until":
    case "weak-until":
      return -1;
    case "ite":
      return 0;
    case "iff":
      return 1;
    case "implies":
      return 2;
    case "or":
      return 3;
    case "and":
      return 4;
    case "not":
      return 5;
    case "atom":
    case "bool":
    case "hole":
    case "always":
    case "eventually":
      return 6;
  }
}

/**
 * Prints `expr` in brackets when it binds looser than `minLevel`, or when it
 * is a prefix temporal operator with more formula after it in the same
 * brackets (`tail` is false): `(always (A)) or B`. Without that the reader
 * would see `always (A) or B` and wonder what the operator covers.
 */
function printStateAt(expr: StateExpr, minLevel: number, tail: boolean): string {
  const prefix = expr.kind === "always" || expr.kind === "eventually";
  const wrap = stateLevel(expr) < minLevel || (prefix && !tail);
  const text = printStateBare(expr, wrap || tail);
  return wrap ? `(${text})` : text;
}

function printWindow(window: Window | undefined): string {
  return window === undefined ? "" : `[${window.from}, ${window.to}]`;
}

/** A side of infix until: bare when it is one atom, a constant or a negation of one; in brackets otherwise. */
function printUntilSide(expr: StateExpr, windowed: boolean): string {
  let core = expr;
  while (core.kind === "not") {
    core = core.operand;
  }
  const simple = core.kind === "atom" || core.kind === "bool" || core.kind === "hole";
  return simple && !windowed ? printStateBare(expr, true) : `(${printStateBare(expr, true)})`;
}

function printStateBare(expr: StateExpr, tail: boolean): string {
  switch (expr.kind) {
    case "atom":
      return `${printMetricRef(expr.ref)} ${expr.op} ${expr.value}`;
    case "bool":
      return String(expr.value);
    case "hole":
      return "_";
    case "always":
    case "eventually":
      return `${expr.kind} ${printWindow(expr.window)}${expr.window === undefined ? "" : " "}(${printStateBare(expr.body, true)})`;
    case "until":
    case "weak-until": {
      const word = expr.kind === "until" ? "until" : "weak until";
      const window = expr.window === undefined ? "" : ` ${printWindow(expr.window)}`;
      const windowed = expr.window !== undefined;
      return `${printUntilSide(expr.hold, windowed)} ${word}${window} ${printUntilSide(expr.goal, windowed)}`;
    }
    case "not":
      return `not ${printStateAt(expr.operand, 5, tail)}`;
    case "and":
    case "or": {
      const last = expr.operands.length - 1;
      return expr.operands
        .map((operand, index) => printStateAt(operand, 5, tail && index === last))
        .join(` ${expr.kind} `);
    }
    case "implies":
      return `${printStateAt(expr.left, 3, false)} implies ${printStateAt(expr.right, 2, tail)}`;
    case "iff":
      return `${printStateAt(expr.left, 2, false)} iff ${printStateAt(expr.right, 2, tail)}`;
    case "ite": {
      const hasElse = expr.else !== undefined;
      const head = `if ${printStateAt(expr.cond, 1, false)} then ${printStateAt(expr.then, 1, tail && !hasElse)}`;
      return expr.else === undefined ? head : `${head} else ${printStateAt(expr.else, 0, tail)}`;
    }
  }
}

/** A formula in word style: `always (A)`, `A until B`, words for logic. */
export function printStateExpr(expr: StateExpr): string {
  return printStateAt(expr, -1, true);
}

export function countAtoms(expr: StateExpr): number {
  switch (expr.kind) {
    case "atom":
      return 1;
    case "bool":
    case "hole":
      return 0;
    case "not":
      return countAtoms(expr.operand);
    case "always":
    case "eventually":
      return countAtoms(expr.body);
    case "until":
    case "weak-until":
      return countAtoms(expr.hold) + countAtoms(expr.goal);
    case "and":
    case "or":
      return expr.operands.reduce((total, operand) => total + countAtoms(operand), 0);
    case "implies":
    case "iff":
      return countAtoms(expr.left) + countAtoms(expr.right);
    case "ite":
      return countAtoms(expr.cond) + countAtoms(expr.then) + (expr.else ? countAtoms(expr.else) : 0);
  }
}

/**
 * Canonical text: word style, such as `always (Waiting <= 5)`,
 * `eventually [0, 30] (count(Done) >= 1)`, `A until B`, `(A) until [0, 30] (B)`,
 * `A weak until B`. A `now` constraint prints as its formula alone.
 */
export function printConstraint(constraint: Constraint): string {
  return printStateExpr(formulaOf(constraint));
}

const MATH_COMPARATORS: Readonly<Record<Comparator, string>> = {
  "<": "<",
  "<=": "≤",
  ">": ">",
  ">=": "≥",
  "==": "=",
  "!=": "≠",
};

/** Binding strength in math notation: infix U and W bind loosest, G and F like ¬. */
function mathLevel(expr: StateExpr): number {
  switch (expr.kind) {
    case "until":
    case "weak-until":
      return 0;
    case "ite":
    case "iff":
      return 1;
    case "implies":
      return 2;
    case "or":
      return 3;
    case "and":
      return 4;
    case "not":
    case "always":
    case "eventually":
      return 5;
    case "atom":
    case "bool":
    case "hole":
      return 6;
  }
}

/** `if c then t else e` as `(c → t) ∧ (¬c → e)`; without else, `c → t`. */
export function expandIte(expr: Extract<StateExpr, { kind: "ite" }>): StateExpr {
  const first: StateExpr = { kind: "implies", left: expr.cond, right: expr.then };
  if (expr.else === undefined) {
    return first;
  }
  const second: StateExpr = { kind: "implies", left: { kind: "not", operand: expr.cond }, right: expr.else };
  return { kind: "and", operands: [first, second] };
}

function printMathAt(expr: StateExpr, minLevel: number): string {
  const shown = expr.kind === "ite" ? expandIte(expr) : expr;
  const text = printMathBare(shown);
  return mathLevel(shown) < minLevel ? `(${text})` : text;
}

/** The operand of ¬, G and F, and a side of U and W: bracketed unless it is a unary operator or a constant. */
function printMathOperand(expr: StateExpr): string {
  const bare =
    expr.kind === "not" ||
    expr.kind === "always" ||
    expr.kind === "eventually" ||
    expr.kind === "bool" ||
    expr.kind === "hole";
  return bare ? printMathBare(expr) : `(${printMathAt(expr, 0)})`;
}

function printMathWindow(window: Window | undefined): string {
  return window === undefined ? "" : `[${window.from},${window.to}]`;
}

function printMathBare(expr: StateExpr): string {
  switch (expr.kind) {
    case "atom":
      return `${printMetricRef(expr.ref)} ${MATH_COMPARATORS[expr.op]} ${expr.value}`;
    case "bool":
      return String(expr.value);
    case "hole":
      return "□";
    case "always":
    case "eventually":
      return `${expr.kind === "always" ? "G" : "F"}${printMathWindow(expr.window)} ${printMathOperand(expr.body)}`;
    case "until":
    case "weak-until": {
      const letter = expr.kind === "until" ? "U" : "W";
      return `${printMathOperand(expr.hold)} ${letter}${printMathWindow(expr.window)} ${printMathOperand(expr.goal)}`;
    }
    case "not":
      return `¬${printMathOperand(expr.operand)}`;
    case "and":
      return expr.operands.map((operand) => printMathAt(operand, 5)).join(" ∧ ");
    case "or":
      return expr.operands.map((operand) => printMathAt(operand, 5)).join(" ∨ ");
    case "implies":
      return `${printMathAt(expr.left, 3)} → ${printMathAt(expr.right, 2)}`;
    case "iff":
      return `${printMathAt(expr.left, 2)} ↔ ${printMathAt(expr.right, 2)}`;
    case "ite":
      return printMathAt(expandIte(expr), 0);
  }
}

/**
 * Math notation: G, F, U, W; windows as `F[0,30]`; ∧ ∨ ¬ → ↔; ≤ ≥ ≠ =; holes
 * as □; metric references as written. if/then/else prints as its expansion
 * `(c → t) ∧ (¬c → e)`, so it reads back as that expansion; every other AST
 * reads back unchanged.
 */
export function printMath(constraint: Constraint): string {
  return printMathAt(formulaOf(constraint), 0);
}
