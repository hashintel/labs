import type { NetItem } from "../ir/net-item";

/**
 * The SPN module graph: what the clocks strategy lowers a stochastic net to
 * before the Python is written. It follows Zeroth's SPN theory, after its
 * own `birth_death.py`: a place is a Nat counter, a transition owns a Clock
 * armed with an exponential delay and an Event it toggles when it fires,
 * and every clock runs down against one external time reference. A
 * transition in a conflict the options leave open also reads a Bool pick that
 * nothing drives.
 *
 * The expressions are the forms the theory's sugar accepts: a count is
 * tested against zero and stepped by one, a clock is tested against zero,
 * kept non-negative and run at a constant rate against the time reference,
 * and an event is read with `fired`. Awaits are implicit: `fired(ev)` awaits
 * the event and `d(t)` awaits the time reference, so no reference is marked
 * `next`. A variable that does not move flows `0`, and a module without a
 * `flow` gets that zero flow for every variable it drives. No interpreter runs
 * this graph: time is continuous.
 */

export type SpnSort = "nat" | "clock" | "event" | "bool";

export type SpnVariable = {
  name: string;
  sort: SpnSort;
  /**
   * `time`: the external reference every clock runs against. `place`: a
   * token count. `clock`: the time left until a transition fires, hidden in
   * the system. `event`: what a transition toggles when it fires. `pick`:
   * the environment lets a transition in a conflict fire when its clock
   * expires; external, and driven by nothing.
   */
  role: "time" | "place" | "clock" | "event" | "pick";
  comment?: string;
};

export type SpnExpr =
  | { kind: "ref"; name: string }
  | { kind: "nat"; value: number }
  | { kind: "bool"; value: boolean }
  /** `x == 0` when `zero`, `x != 0` otherwise: the one test on a count or a clock. */
  | { kind: "test"; operand: SpnExpr; zero: boolean }
  | { kind: "logic"; op: "&"; left: SpnExpr; right: SpnExpr }
  | { kind: "not"; operand: SpnExpr }
  /** `n + 1` or `n - 1`: a count moves one token at a time. */
  | { kind: "step"; op: "+" | "-"; operand: SpnExpr }
  | {
      kind: "ite";
      condition: SpnExpr;
      thenBranch: SpnExpr;
      elseBranch: SpnExpr;
    }
  /**
   * `ite(c, e, None)`, the partial if-then: a value where the condition holds,
   * none otherwise. In `next` the variable stutters there; in `flow` time may
   * not pass there.
   */
  | { kind: "ifThen"; condition: SpnExpr; branch: SpnExpr }
  /** `fired(ev)`: the event changes value this step. */
  | { kind: "fired"; event: string }
  /** `exp(rate)`: a clock armed with an exponential delay. */
  | { kind: "exp"; rate: number }
  /** `clk >= 0`: the invariant that keeps time from passing an expiry. */
  | { kind: "nonNegative"; clock: string }
  /** `factor * d(t)`: a clock's flow against the time reference. */
  | { kind: "rate"; factor: number; time: string }
  /** `0`: the flow of a variable that does not move, such as an event. */
  | { kind: "zeroFlow" };

export type SpnStatement = {
  kind: "assign";
  target: string;
  expr: SpnExpr;
};

export type SpnModule = {
  className: string;
  /** The identifier the instance is bound to when the system composes it. */
  instance: string;
  /** The net item the module stands for: a place or a transition. */
  source: NetItem;
  docstring: string;
  /** Variables the module drives, in parameter order. */
  ctrl: string[];
  /** Variables the module reads but does not drive, in parameter order. */
  extl: string[];
  /** One initial value per `ctrl`. */
  init: SpnExpr[];
  next: SpnStatement[];
  /** One next value per `ctrl`, read after `next`'s statements. */
  returns: SpnExpr[];
  /**
   * One tangent per `ctrl`, `zeroFlow()` for a variable that does not move.
   * Absent on a module with no `flow` method, whose variables all flow `0`.
   */
  flow?: SpnExpr[];
};

export type SpnGraph = {
  language: "spn";
  variables: SpnVariable[];
  /** The system composes every module, in this order. */
  modules: SpnModule[];
  /** Variables the system hides: driven by a module, absent from its interface. */
  hidden: string[];
};

export function ref(name: string): SpnExpr {
  return { kind: "ref", name };
}

export function nat(value: number): SpnExpr {
  return { kind: "nat", value };
}

export function bool(value: boolean): SpnExpr {
  return { kind: "bool", value };
}

export function isZero(operand: SpnExpr): SpnExpr {
  return { kind: "test", operand, zero: true };
}

export function nonZero(operand: SpnExpr): SpnExpr {
  return { kind: "test", operand, zero: false };
}

export function and(left: SpnExpr, right: SpnExpr): SpnExpr {
  return { kind: "logic", op: "&", left, right };
}

export function not(operand: SpnExpr): SpnExpr {
  return { kind: "not", operand };
}

export function inc(operand: SpnExpr): SpnExpr {
  return { kind: "step", op: "+", operand };
}

export function dec(operand: SpnExpr): SpnExpr {
  return { kind: "step", op: "-", operand };
}

export function ite(condition: SpnExpr, thenBranch: SpnExpr, elseBranch: SpnExpr): SpnExpr {
  return { kind: "ite", condition, thenBranch, elseBranch };
}

export function ifThen(condition: SpnExpr, branch: SpnExpr): SpnExpr {
  return { kind: "ifThen", condition, branch };
}

export function fired(event: string): SpnExpr {
  return { kind: "fired", event };
}

export function exp(rate: number): SpnExpr {
  return { kind: "exp", rate };
}

export function nonNegative(clock: string): SpnExpr {
  return { kind: "nonNegative", clock };
}

export function rate(factor: number, time: string): SpnExpr {
  return { kind: "rate", factor, time };
}

export function zeroFlow(): SpnExpr {
  return { kind: "zeroFlow" };
}

/** The terms joined with `&`, left to right; `null` for no terms. */
export function conjunction(terms: SpnExpr[]): SpnExpr | null {
  return terms.reduce<SpnExpr | null>((all, term) => (all === null ? term : and(all, term)), null);
}

export function assign(target: string, expr: SpnExpr): SpnStatement {
  return { kind: "assign", target, expr };
}
