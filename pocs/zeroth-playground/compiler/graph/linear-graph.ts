import type { NetItem } from "../ir/net-item";

/**
 * The reactive module graph: what a compiler lowers a net to before any
 * target syntax is chosen. A graph is a set of typed variables, a set of
 * modules that each drive some of them and read others, and a root that
 * says how the modules make up the system.
 *
 * The model follows Zeroth's reactive modules: a variable has one driver;
 * a module's `next` computes each driven variable's next value from the
 * latched values of the variables it reads, or from the next value of a
 * variable another module drives in the same round (`next: true` on a
 * reference, an await). Awaits must form a DAG, which composition orders.
 */

export type LinearSort = "int" | "real" | "bool";

/** The theory a module's expressions are typed in. */
export type Theory = "LIA" | "LRA";

export type LinearVariable = {
  name: string;
  sort: LinearSort;
  /**
   * `place`: a token count. `input`: an external the harness writes each
   * round, such as a draw or a choice. `flag`: a Bool a module drives for
   * the others to await.
   */
  role: "place" | "input" | "flag";
  comment?: string;
};

/**
 * Arithmetic on numbers, comparisons from numbers to Bool, and `&`/`|` on
 * Bool. Multiplication exists only by a constant, as `scale`, because the
 * theories are linear.
 */
export type LinearBinaryOperator = "+" | "-" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "&" | "|";

export type LinearExpr =
  | {
      kind: "ref";
      name: string;
      /** The variable's next value, awaited from its driver; latched when false. */
      next: boolean;
    }
  | { kind: "num"; value: number }
  | { kind: "bool"; value: boolean }
  | {
      kind: "binary";
      op: LinearBinaryOperator;
      left: LinearExpr;
      right: LinearExpr;
    }
  | {
      kind: "ite";
      condition: LinearExpr;
      thenBranch: LinearExpr;
      elseBranch: LinearExpr;
    }
  | { kind: "not"; operand: LinearExpr }
  /** `factor * operand`, the one multiplication a linear theory has. */
  | { kind: "scale"; factor: number; operand: LinearExpr }
  /** `max(0, operand)`; `max`, `min` and `abs` are written with it. */
  | { kind: "relu"; operand: LinearExpr };

export type LinearStatement =
  | { kind: "comment"; text: string }
  /** Binds a local; a local named like a variable shadows it from here on. */
  | { kind: "assign"; target: string; expr: LinearExpr; comment?: string };

export type LinearModule = {
  className: string;
  /** The identifier the instance is bound to when the root composes it. */
  instance: string;
  /** The net item the module stands for: the whole net, a place or a transition. */
  source: NetItem;
  /** A transition's draw module, which stands for the transition beside its own module. */
  draw?: true;
  docstring: string;
  theory: Theory;
  /** Variables the module drives, in parameter order. */
  ctrl: string[];
  /** Variables the module reads but does not drive, in parameter order. */
  extl: string[];
  /** One initial value per `ctrl`. */
  init: LinearExpr[];
  next: LinearStatement[];
  /** One next value per `ctrl`, read after `next`'s statements. */
  returns: LinearExpr[];
};

export type LinearGraph = {
  /** A graph in a linear theory; the SPN module graph is the other language. */
  language: "linear";
  variables: LinearVariable[];
  modules: LinearModule[];
  /** The system: one module's instance, or the composition of them all. */
  root: { kind: "single"; module: string } | { kind: "compose"; modules: string[] };
};

export function ref(name: string): LinearExpr {
  return { kind: "ref", name, next: false };
}

export function next(name: string): LinearExpr {
  return { kind: "ref", name, next: true };
}

export function num(value: number): LinearExpr {
  return { kind: "num", value };
}

export function bool(value: boolean): LinearExpr {
  return { kind: "bool", value };
}

export function binary(op: LinearBinaryOperator, left: LinearExpr, right: LinearExpr): LinearExpr {
  return { kind: "binary", op, left, right };
}

export function ite(
  condition: LinearExpr,
  thenBranch: LinearExpr,
  elseBranch: LinearExpr,
): LinearExpr {
  return { kind: "ite", condition, thenBranch, elseBranch };
}

export function not(operand: LinearExpr): LinearExpr {
  return { kind: "not", operand };
}

export function scale(factor: number, operand: LinearExpr): LinearExpr {
  return { kind: "scale", factor, operand };
}

export function relu(operand: LinearExpr): LinearExpr {
  return { kind: "relu", operand };
}

/** `max(a, b)` as `a + relu(b - a)`. */
export function max(left: LinearExpr, right: LinearExpr): LinearExpr {
  return binary("+", left, relu(binary("-", right, left)));
}

/** `min(a, b)` as `a - relu(a - b)`. */
export function min(left: LinearExpr, right: LinearExpr): LinearExpr {
  return binary("-", left, relu(binary("-", left, right)));
}

/** The terms joined with `|`; `null` for no terms. */
export function disjunction(terms: LinearExpr[]): LinearExpr | null {
  return terms.reduce<LinearExpr | null>(
    (any, term) => (any === null ? term : binary("|", any, term)),
    null,
  );
}

/** `current` changed by `amount` when `condition` holds; unconditionally without one. */
export function changedWhen(
  condition: LinearExpr | null,
  current: LinearExpr,
  op: "+" | "-",
  amount: number,
): LinearExpr {
  const changed = binary(op, current, num(amount));
  return condition === null ? changed : ite(condition, changed, current);
}

/** `current` changed by a signed `delta` when `condition` holds. */
export function changedBy(
  condition: LinearExpr | null,
  current: LinearExpr,
  delta: number,
): LinearExpr {
  return changedWhen(condition, current, delta > 0 ? "+" : "-", Math.abs(delta));
}

/** The terms joined with `&`; `null` for no terms. */
export function conjunction(terms: LinearExpr[]): LinearExpr | null {
  return terms.reduce<LinearExpr | null>(
    (guard, term) => (guard === null ? term : binary("&", guard, term)),
    null,
  );
}

export function comment(text: string): LinearStatement {
  return { kind: "comment", text };
}

export function assign(target: string, expr: LinearExpr, trailer?: string): LinearStatement {
  return { kind: "assign", target, expr, ...(trailer === undefined ? {} : { comment: trailer }) };
}
