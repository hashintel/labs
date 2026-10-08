import { atomText, constraintAtoms, printStateExpr } from "../../constraints";
import { formatNumber } from "./timeline-model";

import { COMPARATOR_SYMBOLS } from "../../constraints/ast";
import type { Comparator, Constraint, ConstraintDocument, StateExpr } from "../../constraints/ast";
import type { Evaluation } from "../../constraints";

type Atom = Extract<StateExpr, { kind: "atom" }>;

/** The truth of a state expression from its atoms' truth, or `undefined` where it holds a temporal operator or a hole. */
function valueOf(expr: StateExpr, truthOf: (atom: Atom) => boolean): boolean | undefined {
  switch (expr.kind) {
    case "atom":
      return truthOf(expr);
    case "bool":
      return expr.value;
    case "not": {
      const operand = valueOf(expr.operand, truthOf);
      return operand === undefined ? undefined : !operand;
    }
    case "and":
    case "or": {
      const values = expr.operands.map((operand) => valueOf(operand, truthOf));
      if (values.includes(undefined)) {
        return undefined;
      }
      return expr.kind === "and" ? values.every(Boolean) : values.some(Boolean);
    }
    case "implies": {
      const left = valueOf(expr.left, truthOf);
      const right = valueOf(expr.right, truthOf);
      return left === undefined || right === undefined ? undefined : !left || right;
    }
    case "iff": {
      const left = valueOf(expr.left, truthOf);
      const right = valueOf(expr.right, truthOf);
      return left === undefined || right === undefined ? undefined : left === right;
    }
    case "ite": {
      const cond = valueOf(expr.cond, truthOf);
      const chosen = cond === true ? expr.then : expr.else;
      return cond === undefined || chosen === undefined ? undefined : valueOf(chosen, truthOf);
    }
    default:
      return undefined;
  }
}

/** An atom that explains why `expr` has the truth `target`, or `undefined` when none does. */
function culprit(expr: StateExpr, target: boolean, truthOf: (atom: Atom) => boolean): Atom | undefined {
  switch (expr.kind) {
    case "atom":
      return expr;
    case "not":
      return culprit(expr.operand, !target, truthOf);
    case "and":
    case "or": {
      // `and` is false by its first false operand and `or` true by its first true one; otherwise any operand shows it.
      const decisive = expr.kind === "or" ? target : !target;
      const pick = decisive ? expr.operands.find((operand) => valueOf(operand, truthOf) === target) : expr.operands[0];
      return pick === undefined ? undefined : culprit(pick, target, truthOf);
    }
    case "implies":
      if (!target) {
        return culprit(expr.right, false, truthOf);
      }
      return valueOf(expr.left, truthOf) === false
        ? culprit(expr.left, false, truthOf)
        : culprit(expr.right, true, truthOf);
    case "iff": {
      const left = valueOf(expr.left, truthOf);
      return left === undefined ? undefined : culprit(expr.left, left, truthOf);
    }
    case "ite": {
      const cond = valueOf(expr.cond, truthOf);
      const chosen = cond === true ? expr.then : expr.else;
      return chosen === undefined ? undefined : culprit(chosen, target, truthOf);
    }
    default:
      return undefined;
  }
}

/** A formula's printed text as the team writes it: comparators as symbols and keywords in capitals, so `not Waiting <= 5` reads `NOT Waiting ≤ 5`. */
export function withSymbols(text: string): string {
  return text
    .replace(/<=|>=|==|!=/gu, (op) => COMPARATOR_SYMBOLS[op as Comparator])
    .replace(/\b(weak until|always|eventually|until|and|or|not|iff|if|then|else)\b/gu, (word) => word.toUpperCase());
}

function plural(count: number, noun: string): string {
  return `${formatNumber(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** Which side of its threshold the value lies on, given whether the atom holds; `undefined` for equality. */
function sideOf(op: Comparator, holds: boolean): "above" | "below" | undefined {
  if (op === "<" || op === "<=") {
    return holds ? "below" : "above";
  }
  if (op === ">" || op === ">=") {
    return holds ? "above" : "below";
  }
  return undefined;
}

/** What the atom's subject did at a state: "Waiting reached 6", "Restock fired". `undefined` without a value. */
function phrase(atom: Atom, holds: boolean, value: number | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  const side = sideOf(atom.op, holds);
  const verb = side === "above" ? "reached" : side === "below" ? "fell to" : "was";
  switch (atom.ref.kind) {
    case "metric":
      return `${atom.ref.name} ${verb} ${formatNumber(value)}`;
    case "count":
      return `${atom.ref.place} ${verb} ${plural(value, "token")}`;
    case "fired":
      if (value === 0) {
        return `${atom.ref.transition} had not fired`;
      }
      return value === 1 ? `${atom.ref.transition} fired` : `${atom.ref.transition} had fired ${plural(value, "time")}`;
  }
}

function stepsText(count: number): string {
  return count === 1 ? "1 step" : `${count} steps`;
}

/** The deciding condition's phrase at a step, for a constraint the online tables decide. */
function explain(doc: ConstraintDocument, evaluation: Evaluation, step: number, broken: boolean): string | undefined {
  if (evaluation.check !== "online") {
    return undefined;
  }
  const series = new Map(evaluation.atoms.map((atom) => [atom.text, atom]));
  const truthOf = (atom: Atom) => series.get(atomText(atom))?.truth[step] ?? false;
  const { constraint } = doc;
  let expr: StateExpr;
  let target: boolean;
  switch (constraint.op) {
    case "always":
      expr = constraint.body;
      target = false;
      break;
    case "eventually":
      expr = constraint.body;
      target = true;
      break;
    case "now":
      expr = constraint.body;
      target = !broken;
      break;
    default:
      // Until and weak until break when the hold fails, and are met when the goal arrives.
      expr = broken ? constraint.hold : constraint.goal;
      target = !broken;
  }
  const atom = culprit(expr, target, truthOf);
  const data = atom === undefined ? undefined : series.get(atomText(atom));
  return atom === undefined || data === undefined
    ? undefined
    : phrase(atom, data.truth[step] ?? false, data.lhs[step] ?? null);
}

/**
 * One plain sentence for the run: the verdict, the step it was decided at,
 * and the condition that decided it with its value. `null` while a slot of
 * the constraint is open.
 */
export function summarise(doc: ConstraintDocument, evaluation: Evaluation, lastStep: number): string | null {
  if (evaluation.incomplete) {
    return null;
  }
  const { finalVerdict, decidedAt } = evaluation;
  const { constraint } = doc;
  if (finalVerdict === "pending") {
    return "Not decided: the run ended first.";
  }
  const broken = finalVerdict === "violated";
  if (decidedAt === null) {
    if (broken) {
      return constraint.op === "eventually" || constraint.op === "until"
        ? `Never met in ${stepsText(lastStep)}.`
        : "Broken at the end of the run.";
    }
    if (constraint.op === "always" || constraint.op === "weak-until") {
      return constraint.window === undefined ? `Held for all ${stepsText(lastStep)}.` : "Held across the whole time window.";
    }
    return "Held at the end of the run.";
  }
  const head = `${broken ? "Broken" : "Met"} at step ${decidedAt}`;
  const found = explain(doc, evaluation, decidedAt, broken);
  return found === undefined ? `${head}.` : `${head}: ${found}.`;
}

/** The values the rule compares the named metric with, once each: the dashed lines of its row. */
export function thresholdsOf(doc: ConstraintDocument, metric: string): number[] {
  const values = constraintAtoms(doc.constraint)
    .filter((atom) => atom.ref.kind === "metric" && atom.ref.name === metric)
    .flatMap((atom) => (typeof atom.value === "number" ? [atom.value] : []));
  return [...new Set(values)];
}

/**
 * The win condition of a rule in one sentence, read off its top operator,
 * with each condition in code between backticks: "Passes if `Waiting <= 5`
 * at every step". A time window adds "between time a and b".
 */
export function passCondition(constraint: Constraint): string {
  const window =
    constraint.op === "now" || constraint.window === undefined
      ? ""
      : ` between time ${formatNumber(constraint.window.from)} and ${formatNumber(constraint.window.to)}`;
  switch (constraint.op) {
    case "now":
      return `Passes if \`${withSymbols(printStateExpr(constraint.body))}\` at step 0`;
    case "always":
      return `Passes if \`${withSymbols(printStateExpr(constraint.body))}\` at every step${window}`;
    case "eventually":
      return `Passes if \`${withSymbols(printStateExpr(constraint.body))}\` at some step${window}`;
    case "until":
      return `Passes if \`${withSymbols(printStateExpr(constraint.goal))}\` happens${window}, with \`${withSymbols(printStateExpr(constraint.hold))}\` true at every step before it`;
    case "weak-until":
      return `Passes if \`${withSymbols(printStateExpr(constraint.hold))}\` stays true until \`${withSymbols(printStateExpr(constraint.goal))}\` happens${window}, or to the end of the run`;
  }
}
