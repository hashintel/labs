import { formulaOf } from "./formula";
import { isV1 } from "./scope";
import { atomText, constraintAtoms } from "./walk";

import type { Comparator, Constraint, ConstraintDocument, MetricExpr, MetricRef, StateExpr, Verdict, Window } from "./ast";
import type { Diagnostic } from "./diagnostics";
import type { RunState, StopReason } from "./simulate";

export type MetricSeries = { name: string; values: (number | null)[] };

export type AtomSeries = {
  text: string;
  ref: MetricRef;
  op: Comparator;
  value: number | MetricRef;
  /** The left side's value at each state. `null` where it could not be computed. */
  lhs: (number | null)[];
  /** The right side's value at each state, when it is a metric. `null` where it could not be computed. */
  rhs?: (number | null)[];
  truth: boolean[];
};

/** A truth value that a window running past the end of the run can leave open. */
export type Truth3 = boolean | "unknown";

export type Evaluation = {
  /** Every defined metric, in document order. */
  metrics: MetricSeries[];
  /** Every distinct atom, in reading order. */
  atoms: AtomSeries[];
  /**
   * Truth of the top operator's operands at each state. For a nested,
   * windowed or `now` constraint it is the finite-trace truth from that
   * state, with "unknown" shown as false; `formulaTruth` keeps "unknown".
   */
  truth: { body?: boolean[]; hold?: boolean[]; goal?: boolean[] };
  /** The online verdict at each state: monotonic once decided. Empty while the constraint has a hole. */
  verdicts: Verdict[];
  /** The verdict after the last state, with the end-of-run rule applied. */
  finalVerdict: Verdict;
  /** The first state where the verdict was decided, or `null` if the end of the run decided it. */
  decidedAt: number | null;
  /** True when the constraint has an unfilled slot: then there is no verdict. */
  incomplete: boolean;
  /**
   * How the verdict was reached. `online`: the base tables in SPEC.md. `monitor`:
   * a nested, windowed or `now` constraint, decided at the first state whose
   * prefix fixes it, else at the end by the finite-trace semantics (checked
   * offline). `none`: a hole, no verdict.
   */
  check: "online" | "monitor" | "none";
  /** For `monitor`: the whole formula's truth at each state, over the whole run. */
  formulaTruth?: Truth3[];
  /** When the run ends, in run time: `maxTime` if it stopped there, else the last state's time. */
  endTime: number;
  diagnostics: Diagnostic[];
};

/** How the run ended, which fixes the end of the last state's time. */
export type EvaluateOptions = { stopReason?: StopReason };

export const HOLE_INFO = "Fill every slot to get a verdict";
export const WINDOW_PAST_END_INFO = "A time window runs past the end of the run, so the end-of-run rule decides";
export const NOW_WINDOW_PAST_END_INFO = "A time window runs past the end of the run, so there is no verdict";
export const MONITOR_MISMATCH_ERROR = "The online and offline verdicts disagree. This is a bug in the evaluator";

function compare(left: number, op: Comparator, right: number): boolean {
  switch (op) {
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "==":
      return left === right;
    case "!=":
      return left !== right;
  }
}

type Reader = {
  metricAt: (name: string) => number | null;
  refAt: (ref: MetricRef) => number | null;
};

/**
 * Reads metrics at one state. A value that cannot be computed (division by
 * zero, an unknown name, a cycle) is `null` and is reported once through `report`.
 */
function createReader(
  doc: ConstraintDocument,
  state: RunState,
  report: (message: string) => void,
): Reader {
  const definitions = new Map(doc.metrics.map((metric) => [metric.name, metric.expr]));
  const memo = new Map<string, number | null>();
  const visiting: string[] = [];

  function exprValue(expr: MetricExpr): number | null {
    switch (expr.kind) {
      case "number":
        return expr.value;
      case "count":
      case "fired":
      case "metric":
        return refAt(expr);
      case "negate": {
        const operand = exprValue(expr.operand);
        return operand === null ? null : -operand;
      }
      case "binary": {
        const left = exprValue(expr.left);
        const right = exprValue(expr.right);
        if (left === null || right === null) {
          return null;
        }
        switch (expr.op) {
          case "+":
            return left + right;
          case "-":
            return left - right;
          case "*":
            return left * right;
          case "/":
            if (right === 0) {
              const owner = visiting[visiting.length - 1];
              report(`Division by zero${owner === undefined ? "" : ` in ${owner}`}`);
              return null;
            }
            return left / right;
        }
      }
    }
  }

  function metricAt(name: string): number | null {
    if (memo.has(name)) {
      return memo.get(name) ?? null;
    }
    const expr = definitions.get(name);
    if (expr === undefined) {
      report(`Unknown metric ${name}`);
      return null;
    }
    if (visiting.includes(name)) {
      report(`Metric ${name} depends on itself`);
      return null;
    }
    visiting.push(name);
    const value = exprValue(expr);
    visiting.pop();
    memo.set(name, value);
    return value;
  }

  function refAt(ref: MetricRef): number | null {
    switch (ref.kind) {
      case "metric":
        return metricAt(ref.name);
      case "count": {
        const count = state.marking[ref.place];
        if (count === undefined) {
          report(`Unknown place ${ref.place}`);
          return null;
        }
        return count;
      }
      case "fired": {
        const count = state.fired[ref.transition];
        if (count === undefined) {
          report(`Unknown transition ${ref.transition}`);
          return null;
        }
        return count;
      }
    }
  }

  return { metricAt, refAt };
}

/** The right side of an atom at one state: the number, or the metric's value (`null` where it cannot be computed). */
function valueAt(value: number | MetricRef, reader: Reader): number | null {
  return typeof value === "number" ? value : reader.refAt(value);
}

/** Truth at one state of a formula with no temporal operator and no hole (base operands). */
/**
 * The truth of a state formula at one state. `positive` tracks whether the
 * node sits under an even number of negations, counting the left of
 * `implies`. An atom whose metric cannot be computed counts as false where it
 * stands, even under `not`: it reads false in a positive place and true in a
 * negative one, so it never makes the formula hold. `iff` and `if … then …
 * else` are read as their implications, so each part gets its own polarity.
 */
function stateTruth(expr: StateExpr, reader: Reader, positive = true): boolean {
  switch (expr.kind) {
    case "atom": {
      const value = reader.refAt(expr.ref);
      const bound = valueAt(expr.value, reader);
      return value === null || bound === null ? !positive : compare(value, expr.op, bound);
    }
    case "bool":
      return expr.value;
    case "not":
      return !stateTruth(expr.operand, reader, !positive);
    case "and":
      return expr.operands.every((operand) => stateTruth(operand, reader, positive));
    case "or":
      return expr.operands.some((operand) => stateTruth(operand, reader, positive));
    case "implies":
      return !stateTruth(expr.left, reader, !positive) || stateTruth(expr.right, reader, positive);
    case "iff":
      return (
        (!stateTruth(expr.left, reader, !positive) || stateTruth(expr.right, reader, positive)) &&
        (!stateTruth(expr.right, reader, !positive) || stateTruth(expr.left, reader, positive))
      );
    case "ite": {
      const then = !stateTruth(expr.cond, reader, !positive) || stateTruth(expr.then, reader, positive);
      const otherwise =
        expr.else === undefined || stateTruth(expr.cond, reader, positive) || stateTruth(expr.else, reader, positive);
      return then && otherwise;
    }
    case "hole":
    case "always":
    case "eventually":
    case "until":
    case "weak-until":
      throw new Error(`stateTruth reads one state; ${expr.kind} needs the run`);
  }
}

function hasHole(expr: StateExpr): boolean {
  switch (expr.kind) {
    case "hole":
      return true;
    case "atom":
    case "bool":
      return false;
    case "not":
      return hasHole(expr.operand);
    case "always":
    case "eventually":
      return hasHole(expr.body);
    case "until":
    case "weak-until":
      return hasHole(expr.hold) || hasHole(expr.goal);
    case "and":
    case "or":
      return expr.operands.some(hasHole);
    case "implies":
    case "iff":
      return hasHole(expr.left) || hasHole(expr.right);
    case "ite":
      return hasHole(expr.cond) || hasHole(expr.then) || (expr.else !== undefined && hasHole(expr.else));
  }
}

/** When the run ends: `maxTime` if it stopped there, else the last state's time. */
export function runEndTime(doc: ConstraintDocument, states: readonly RunState[], options: EvaluateOptions = {}): number {
  const lastTime = states.at(-1)?.time ?? 0;
  if (options.stopReason === "max-time" && doc.run.maxTime !== undefined) {
    return Math.max(lastTime, doc.run.maxTime);
  }
  return lastTime;
}

// ---------------------------------------------------------------------------
// Three-valued finite-trace semantics (SPEC.md, "Nested operators and windows")
// ---------------------------------------------------------------------------

const UNKNOWN = "unknown";

function and3(left: Truth3, right: Truth3): Truth3 {
  if (left === false || right === false) {
    return false;
  }
  return left === true && right === true ? true : UNKNOWN;
}

function or3(left: Truth3, right: Truth3): Truth3 {
  if (left === true || right === true) {
    return true;
  }
  return left === false && right === false ? false : UNKNOWN;
}

function not3(value: Truth3): Truth3 {
  return value === UNKNOWN ? UNKNOWN : !value;
}

/**
 * The states in view. Offline, `end` is the run's end time and the last state
 * holds from its time to `end`. On a prefix `end` is `null`: the run may go
 * on, so nothing after the last state's time is known.
 */
type Frame = {
  last: number;
  times: readonly number[];
  end: number | null;
  atom: (atom: Extract<StateExpr, { kind: "atom" }>, position: number) => boolean;
};

/** A window seen from state `i`: its bounds in run time and whether every state it touches is known. */
function span(frame: Frame, position: number, window: Window): { lo: number; hi: number; complete: boolean } {
  const start = frame.times[position] ?? 0;
  const lo = start + window.from;
  const hi = start + window.to;
  const lastTime = frame.times[frame.last] ?? 0;
  const complete = frame.end === null ? hi < lastTime : hi <= frame.end;
  return { lo, hi, complete };
}

/**
 * Whether state `j` is known to hold at some instant of [lo, hi]. State `j`
 * holds over [t_j, t_{j+1}); a state that lasts no time is still seen at its
 * instant t_j. The last state holds over [t_n, end] offline; on a prefix only
 * its own instant is known.
 */
function touches(frame: Frame, j: number, lo: number, hi: number): boolean {
  const start = frame.times[j] ?? 0;
  if (start > hi) {
    return false;
  }
  if (start >= lo) {
    return true;
  }
  if (j < frame.last) {
    return (frame.times[j + 1] ?? start) > lo;
  }
  return frame.end !== null && frame.end >= lo;
}

function alwaysWindow(frame: Frame, body: Truth3[], position: number, window: Window): Truth3 {
  const { lo, hi, complete } = span(frame, position, window);
  let result: Truth3 = true;
  for (let j = position; j <= frame.last && (frame.times[j] ?? 0) <= hi; j += 1) {
    if (touches(frame, j, lo, hi)) {
      result = and3(result, body[j] ?? UNKNOWN);
    }
  }
  return complete ? result : and3(result, UNKNOWN);
}

function eventuallyWindow(frame: Frame, body: Truth3[], position: number, window: Window): Truth3 {
  const { lo, hi, complete } = span(frame, position, window);
  let result: Truth3 = false;
  for (let j = position; j <= frame.last && (frame.times[j] ?? 0) <= hi; j += 1) {
    if (touches(frame, j, lo, hi)) {
      result = or3(result, body[j] ?? UNKNOWN);
    }
  }
  return complete ? result : or3(result, UNKNOWN);
}

/**
 * Strong until with a window: the goal holds at some state j that touches
 * [t_i + a, t_i + b], the hold holds at every state from i up to j, and at j
 * too when j began before t_i + a (it must hold until the window opens).
 */
function untilWindow(frame: Frame, hold: Truth3[], goal: Truth3[], position: number, window: Window): Truth3 {
  const { lo, hi, complete } = span(frame, position, window);
  let result: Truth3 = false;
  let heldSoFar: Truth3 = true;
  for (let j = position; j <= frame.last && (frame.times[j] ?? 0) <= hi; j += 1) {
    const holdHere = hold[j] ?? UNKNOWN;
    if (touches(frame, j, lo, hi)) {
      const beforeWindow = (frame.times[j] ?? 0) < lo;
      result = or3(result, and3(goal[j] ?? UNKNOWN, and3(heldSoFar, beforeWindow ? holdHere : true)));
    }
    heldSoFar = and3(heldSoFar, holdHere);
  }
  return complete ? result : or3(result, and3(heldSoFar, UNKNOWN));
}

function series(expr: StateExpr, frame: Frame, memo: Map<StateExpr, Truth3[]>): Truth3[] {
  const cached = memo.get(expr);
  if (cached !== undefined) {
    return cached;
  }
  const positions = Array.from({ length: frame.last + 1 }, (_, index) => index);
  const of = (child: StateExpr) => series(child, frame, memo);
  let result: Truth3[];
  switch (expr.kind) {
    case "hole":
      result = positions.map(() => UNKNOWN);
      break;
    case "atom":
      result = positions.map((position) => frame.atom(expr, position));
      break;
    case "bool":
      result = positions.map(() => expr.value);
      break;
    case "not":
      result = of(expr.operand).map(not3);
      break;
    case "and":
    case "or": {
      const parts = expr.operands.map(of);
      const join = expr.kind === "and" ? and3 : or3;
      result = positions.map((position) =>
        parts.reduce<Truth3>((acc, part) => join(acc, part[position] ?? UNKNOWN), expr.kind === "and"),
      );
      break;
    }
    case "implies": {
      const left = of(expr.left);
      const right = of(expr.right);
      result = positions.map((position) => or3(not3(left[position] ?? UNKNOWN), right[position] ?? UNKNOWN));
      break;
    }
    case "iff": {
      const left = of(expr.left);
      const right = of(expr.right);
      result = positions.map((position) => {
        const a = left[position] ?? UNKNOWN;
        const b = right[position] ?? UNKNOWN;
        return a === UNKNOWN || b === UNKNOWN ? UNKNOWN : a === b;
      });
      break;
    }
    case "ite": {
      const cond = of(expr.cond);
      const thenSide = of(expr.then);
      const elseSide = expr.else === undefined ? undefined : of(expr.else);
      result = positions.map((position) => {
        const c = cond[position] ?? UNKNOWN;
        return and3(or3(not3(c), thenSide[position] ?? UNKNOWN), or3(c, elseSide?.[position] ?? true));
      });
      break;
    }
    case "always":
    case "eventually": {
      const body = of(expr.body);
      if (expr.window !== undefined) {
        const window = expr.window;
        const pick = expr.kind === "always" ? alwaysWindow : eventuallyWindow;
        result = positions.map((position) => pick(frame, body, position, window));
        break;
      }
      // Backwards: G φ at i is φ(i) and G φ at i + 1. Past the last state:
      // offline the run has ended (G true, F false); on a prefix it is unknown.
      const isAlways = expr.kind === "always";
      let next: Truth3 = frame.end === null ? UNKNOWN : isAlways;
      result = new Array<Truth3>(frame.last + 1);
      for (let position = frame.last; position >= 0; position -= 1) {
        next = isAlways ? and3(body[position] ?? UNKNOWN, next) : or3(body[position] ?? UNKNOWN, next);
        result[position] = next;
      }
      break;
    }
    case "until":
    case "weak-until": {
      const hold = of(expr.hold);
      const goal = of(expr.goal);
      if (expr.window !== undefined) {
        const window = expr.window;
        const strong = positions.map((position) => untilWindow(frame, hold, goal, position, window));
        if (expr.kind === "until") {
          result = strong;
        } else {
          // φ W[a,b] ψ is φ U[a,b] ψ, or φ at every state touching [t_i, t_i + b].
          const horizon = { from: 0, to: window.to };
          result = strong.map((value, position) => or3(value, alwaysWindow(frame, hold, position, horizon)));
        }
        break;
      }
      // Backwards: ψ(i) or (φ(i) and the same at i + 1). Past the last state:
      // offline, until is false and weak until true; on a prefix, unknown.
      let next: Truth3 = frame.end === null ? UNKNOWN : expr.kind === "weak-until";
      result = new Array<Truth3>(frame.last + 1);
      for (let position = frame.last; position >= 0; position -= 1) {
        next = or3(goal[position] ?? UNKNOWN, and3(hold[position] ?? UNKNOWN, next));
        result[position] = next;
      }
      break;
    }
  }
  memo.set(expr, result);
  return result;
}

/** Applies the end-of-run rule of the top operator to a formula left unknown by a window. */
function verdictOf(value: Truth3, op: Constraint["op"]): Verdict {
  if (value === true) {
    return "satisfied";
  }
  if (value === false) {
    return "violated";
  }
  switch (op) {
    case "always":
    case "weak-until":
      return "satisfied";
    case "eventually":
    case "until":
      return "violated";
    case "now":
      return "pending";
  }
}

/** The constraint's operands, the series `truth` reports for them. */
function operands(constraint: Constraint): { body?: StateExpr; hold?: StateExpr; goal?: StateExpr } {
  return "body" in constraint ? { body: constraint.body } : { hold: constraint.hold, goal: constraint.goal };
}

/**
 * Evaluates a constraint document over a run: metric and atom values at every
 * state, the truth of the state expressions, the online verdict at every state
 * and the final verdict. A base constraint follows the tables in SPEC.md,
 * "Verdicts". A nested, windowed or `now` constraint follows "Nested operators
 * and windows". Pass the run's stop reason so a window knows when the run ended.
 */
export function evaluate(
  doc: ConstraintDocument,
  states: readonly RunState[],
  options: EvaluateOptions = {},
): Evaluation {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const readers = states.map((state) =>
    createReader(doc, state, (message) => {
      if (!seen.has(message)) {
        seen.add(message);
        diagnostics.push({ severity: "error", message: `${message}, first at step ${state.step}` });
      }
    }),
  );

  const metrics = doc.metrics.map((metric) => ({
    name: metric.name,
    values: readers.map((reader) => reader.metricAt(metric.name)),
  }));

  const atoms: AtomSeries[] = [];
  for (const atom of constraintAtoms(doc.constraint)) {
    const text = atomText(atom);
    if (atoms.some((existing) => existing.text === text)) {
      continue;
    }
    const lhs = readers.map((reader) => reader.refAt(atom.ref));
    const rhs = typeof atom.value === "number" ? undefined : readers.map((reader) => valueAt(atom.value, reader));
    atoms.push({
      text,
      ref: atom.ref,
      op: atom.op,
      value: atom.value,
      lhs,
      ...(rhs === undefined ? {} : { rhs }),
      truth: lhs.map((value, at) => {
        const bound = rhs === undefined ? atom.value : rhs[at];
        return value !== null && typeof bound === "number" && compare(value, atom.op, bound);
      }),
    });
  }

  const constraint = doc.constraint;
  const endTime = runEndTime(doc, states, options);
  const formula = formulaOf(constraint);

  if (hasHole(formula)) {
    diagnostics.push({ severity: "info", message: HOLE_INFO });
    return {
      metrics,
      atoms,
      truth: {},
      verdicts: [],
      finalVerdict: "pending",
      decidedAt: null,
      incomplete: true,
      check: "none",
      endTime,
      diagnostics,
    };
  }

  if (!isV1(constraint)) {
    return {
      metrics,
      atoms,
      ...monitor(constraint, formula, readers, states, endTime, diagnostics),
      incomplete: false,
      check: "monitor",
      endTime,
      diagnostics,
    };
  }

  const truthOf = (expr: StateExpr) => readers.map((reader) => stateTruth(expr, reader));
  const truth: Evaluation["truth"] =
    "body" in constraint
      ? { body: truthOf(constraint.body) }
      : { hold: truthOf(constraint.hold), goal: truthOf(constraint.goal) };

  const verdicts: Verdict[] = [];
  let decided: Verdict = "pending";
  let decidedAt: number | null = null;
  for (let step = 0; step < states.length; step += 1) {
    if (decided === "pending") {
      const next = verdictAt(constraint.op, truth, step);
      if (next !== "pending") {
        decided = next;
        decidedAt = step;
      }
    }
    verdicts.push(decided);
  }

  let finalVerdict = decided;
  if (decided === "pending" && states.length > 0) {
    finalVerdict = constraint.op === "always" || constraint.op === "weak-until" ? "satisfied" : "violated";
  }
  return {
    metrics,
    atoms,
    truth,
    verdicts,
    finalVerdict,
    decidedAt,
    incomplete: false,
    check: "online",
    endTime,
    diagnostics,
  };
}

/**
 * Nested, windowed and `now` constraints. Online: the earliest state k whose
 * prefix s0..k fixes the formula's value at s0, read three-valued (anything
 * that depends on states after k is unknown). This is sound: a value fixed
 * on a prefix is the value on every run that extends it. It can be later
 * than the earliest possible step when only reasoning across atoms would show
 * it (such as `eventually(B) or not eventually(B)`). Final: the finite-trace
 * value over the whole run; a value left unknown by a window takes the top
 * operator's end-of-run rule.
 */
function monitor(
  constraint: Constraint,
  formula: StateExpr,
  readers: readonly Reader[],
  states: readonly RunState[],
  endTime: number,
  diagnostics: Diagnostic[],
): Pick<Evaluation, "truth" | "verdicts" | "finalVerdict" | "decidedAt" | "formulaTruth"> {
  const times = states.map((state) => state.time);
  const atomCache = new Map<string, boolean[]>();
  const atom: Frame["atom"] = (node, position) => {
    const key = atomText(node);
    let cached = atomCache.get(key);
    if (cached === undefined) {
      cached = readers.map((reader) => stateTruth(node, reader));
      atomCache.set(key, cached);
    }
    return cached[position] ?? false;
  };
  const last = states.length - 1;
  if (last < 0) {
    return { truth: {}, verdicts: [], finalVerdict: "pending", decidedAt: null, formulaTruth: [] };
  }

  const offlineMemo = new Map<StateExpr, Truth3[]>();
  const offline: Frame = { last, times, end: endTime, atom };
  const formulaTruth = series(formula, offline, offlineMemo);
  const value = formulaTruth[0] ?? UNKNOWN;

  const prefixValue = (k: number): Truth3 =>
    series(formula, { last: k, times, end: null, atom }, new Map())[0] ?? UNKNOWN;

  // A value fixed on a prefix stays fixed on every longer one, so the
  // earliest deciding step is found by bisection.
  let decidedAt: number | null = null;
  if (prefixValue(last) !== UNKNOWN) {
    let low = 0;
    let high = last;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (prefixValue(middle) === UNKNOWN) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    decidedAt = low;
  }

  let finalVerdict = verdictOf(value, constraint.op);
  const verdicts: Verdict[] = [];
  if (decidedAt !== null) {
    const online = verdictOf(prefixValue(decidedAt), constraint.op);
    if (online !== finalVerdict) {
      diagnostics.push({ severity: "error", message: MONITOR_MISMATCH_ERROR });
    }
    finalVerdict = online;
  } else if (value === UNKNOWN) {
    diagnostics.push({
      severity: "info",
      message: constraint.op === "now" ? NOW_WINDOW_PAST_END_INFO : WINDOW_PAST_END_INFO,
    });
  }
  for (let step = 0; step <= last; step += 1) {
    verdicts.push(decidedAt !== null && step >= decidedAt ? finalVerdict : "pending");
  }

  const shown = (expr: StateExpr | undefined) =>
    expr === undefined ? undefined : series(expr, offline, offlineMemo).map((entry) => entry === true);
  const parts = operands(constraint);
  const truth: Evaluation["truth"] = {};
  const body = shown(parts.body);
  const hold = shown(parts.hold);
  const goal = shown(parts.goal);
  if (body !== undefined) {
    truth.body = body;
  }
  if (hold !== undefined) {
    truth.hold = hold;
  }
  if (goal !== undefined) {
    truth.goal = goal;
  }
  return { truth, verdicts, finalVerdict, decidedAt, formulaTruth };
}

/** What state `step` alone decides for a base constraint, given it is still pending. */
function verdictAt(op: Constraint["op"], truth: Evaluation["truth"], step: number): Verdict {
  const body = truth.body?.[step];
  const hold = truth.hold?.[step];
  const goal = truth.goal?.[step];
  switch (op) {
    case "always":
      return body === false ? "violated" : "pending";
    case "eventually":
      return body === true ? "satisfied" : "pending";
    case "until":
    case "weak-until":
      if (goal === true) {
        return "satisfied";
      }
      return hold === false ? "violated" : "pending";
    case "now":
      return body === undefined ? "pending" : body ? "satisfied" : "violated";
  }
}

export type MarginResult = {
  /** The margin formula is not agreed (see SPEC). Show this as provisional. */
  provisional: true;
  value: number;
};

function atomMargin(value: number | null, op: Comparator, bound: number | null): number {
  if (value === null || bound === null) {
    return -Infinity;
  }
  switch (op) {
    case ">":
    case ">=":
      return value - bound;
    case "<":
    case "<=":
      return bound - value;
    case "==":
      return -Math.abs(value - bound);
    case "!=":
      return Math.abs(value - bound);
  }
}

function stateMargin(expr: StateExpr, reader: Reader): number {
  switch (expr.kind) {
    case "atom":
      return atomMargin(reader.refAt(expr.ref), expr.op, valueAt(expr.value, reader));
    case "bool":
      return expr.value ? Infinity : -Infinity;
    case "not":
      return -stateMargin(expr.operand, reader);
    case "and":
      return Math.min(...expr.operands.map((operand) => stateMargin(operand, reader)));
    case "or":
      return Math.max(...expr.operands.map((operand) => stateMargin(operand, reader)));
    case "implies":
      return Math.max(-stateMargin(expr.left, reader), stateMargin(expr.right, reader));
    case "iff": {
      const left = stateMargin(expr.left, reader);
      const right = stateMargin(expr.right, reader);
      return Math.min(Math.max(-left, right), Math.max(-right, left));
    }
    case "ite": {
      const cond = stateMargin(expr.cond, reader);
      const thenMargin = Math.max(-cond, stateMargin(expr.then, reader));
      return expr.else === undefined
        ? thenMargin
        : Math.min(thenMargin, Math.max(cond, stateMargin(expr.else, reader)));
    }
    case "hole":
    case "always":
    case "eventually":
    case "until":
    case "weak-until":
      throw new Error(`stateMargin reads one state; ${expr.kind} needs the run`);
  }
}

/**
 * Robustness of a formula at every state, offline over the whole run: the
 * same recursion as `series`, with min for and/always and max for
 * or/eventually. A window takes the states it touches that the run shows.
 */
function robustness(expr: StateExpr, frame: Frame, readers: readonly Reader[], memo: Map<StateExpr, number[]>): number[] {
  const cached = memo.get(expr);
  if (cached !== undefined) {
    return cached;
  }
  const positions = Array.from({ length: frame.last + 1 }, (_, index) => index);
  const of = (child: StateExpr) => robustness(child, frame, readers, memo);
  const at = (values: number[], position: number) => values[position] ?? -Infinity;
  let result: number[];
  switch (expr.kind) {
    case "hole":
      result = positions.map(() => Number.NaN);
      break;
    case "atom":
      result = positions.map((position) => {
        const reader = readers[position];
        return reader === undefined ? -Infinity : atomMargin(reader.refAt(expr.ref), expr.op, valueAt(expr.value, reader));
      });
      break;
    case "bool":
      result = positions.map(() => (expr.value ? Infinity : -Infinity));
      break;
    case "not":
      result = of(expr.operand).map((value) => -value);
      break;
    case "and":
    case "or": {
      const parts = expr.operands.map(of);
      const pick = expr.kind === "and" ? Math.min : Math.max;
      result = positions.map((position) => pick(...parts.map((part) => at(part, position))));
      break;
    }
    case "implies": {
      const left = of(expr.left);
      const right = of(expr.right);
      result = positions.map((position) => Math.max(-at(left, position), at(right, position)));
      break;
    }
    case "iff": {
      const left = of(expr.left);
      const right = of(expr.right);
      result = positions.map((position) => {
        const a = at(left, position);
        const b = at(right, position);
        return Math.min(Math.max(-a, b), Math.max(-b, a));
      });
      break;
    }
    case "ite": {
      const cond = of(expr.cond);
      const thenSide = of(expr.then);
      const elseSide = expr.else === undefined ? undefined : of(expr.else);
      result = positions.map((position) => {
        const c = at(cond, position);
        const thenMargin = Math.max(-c, at(thenSide, position));
        return elseSide === undefined ? thenMargin : Math.min(thenMargin, Math.max(c, at(elseSide, position)));
      });
      break;
    }
    case "always":
    case "eventually": {
      const body = of(expr.body);
      const isAlways = expr.kind === "always";
      const pick = isAlways ? Math.min : Math.max;
      const empty = isAlways ? Infinity : -Infinity;
      if (expr.window !== undefined) {
        const window = expr.window;
        result = positions.map((position) => {
          const { lo, hi } = span(frame, position, window);
          let value = empty;
          for (let j = position; j <= frame.last && (frame.times[j] ?? 0) <= hi; j += 1) {
            if (touches(frame, j, lo, hi)) {
              value = pick(value, at(body, j));
            }
          }
          return value;
        });
        break;
      }
      let next = empty;
      result = new Array<number>(frame.last + 1);
      for (let position = frame.last; position >= 0; position -= 1) {
        next = pick(at(body, position), next);
        result[position] = next;
      }
      break;
    }
    case "until":
    case "weak-until": {
      const hold = of(expr.hold);
      const goal = of(expr.goal);
      if (expr.window !== undefined) {
        const window = expr.window;
        result = positions.map((position) => {
          const { lo, hi } = span(frame, position, window);
          let value = -Infinity;
          let heldSoFar = Infinity;
          let heldThroughHorizon = Infinity;
          for (let j = position; j <= frame.last && (frame.times[j] ?? 0) <= hi; j += 1) {
            if (touches(frame, j, lo, hi)) {
              const beforeWindow = (frame.times[j] ?? 0) < lo;
              value = Math.max(value, Math.min(at(goal, j), heldSoFar, beforeWindow ? at(hold, j) : Infinity));
            }
            heldSoFar = Math.min(heldSoFar, at(hold, j));
            if (touches(frame, j, frame.times[position] ?? 0, hi)) {
              heldThroughHorizon = Math.min(heldThroughHorizon, at(hold, j));
            }
          }
          return expr.kind === "until" ? value : Math.max(value, heldThroughHorizon);
        });
        break;
      }
      let next = expr.kind === "until" ? -Infinity : Infinity;
      result = new Array<number>(frame.last + 1);
      for (let position = frame.last; position >= 0; position -= 1) {
        next = Math.max(at(goal, position), Math.min(at(hold, position), next));
        result[position] = next;
      }
      break;
    }
  }
  memo.set(expr, result);
  return result;
}

/**
 * PROVISIONAL. How far the constraint is from flipping, per SPEC "Margins":
 * always is the minimum over states, eventually the maximum, until the maximum
 * over k of min(B(k), min over j<k of A(j)). The spec gives no formula for
 * weak until and for iff and if/then/else: here weak until is the larger of
 * until and "A at every state", iff is both implications, and if/then/else is
 * its two implications. A metric that cannot be computed counts as -Infinity.
 * Nested and windowed operators use the same min and max recursively, a
 * window over the states it touches that the run shows. `null` while the
 * constraint has a hole.
 */
export function margin(
  doc: ConstraintDocument,
  states: readonly RunState[],
  options: EvaluateOptions = {},
): MarginResult | null {
  const readers = states.map((state) => createReader(doc, state, () => {}));
  const constraint = doc.constraint;
  const formula = formulaOf(constraint);
  if (hasHole(formula)) {
    return null;
  }
  if (!isV1(constraint)) {
    const frame: Frame = {
      last: states.length - 1,
      times: states.map((state) => state.time),
      end: runEndTime(doc, states, options),
      atom: () => false,
    };
    return { provisional: true, value: robustness(formula, frame, readers, new Map())[0] ?? Number.NaN };
  }
  if (constraint.op === "always") {
    return {
      provisional: true,
      value: Math.min(...readers.map((reader) => stateMargin(constraint.body, reader))),
    };
  }
  if (constraint.op === "eventually") {
    return {
      provisional: true,
      value: Math.max(...readers.map((reader) => stateMargin(constraint.body, reader))),
    };
  }
  if (constraint.op === "now") {
    return { provisional: true, value: Number.NaN };
  }
  let untilMargin = -Infinity;
  let holdSoFar = Infinity;
  for (const reader of readers) {
    untilMargin = Math.max(untilMargin, Math.min(stateMargin(constraint.goal, reader), holdSoFar));
    holdSoFar = Math.min(holdSoFar, stateMargin(constraint.hold, reader));
  }
  const value = constraint.op === "weak-until" ? Math.max(untilMargin, holdSoFar) : untilMargin;
  return { provisional: true, value };
}
