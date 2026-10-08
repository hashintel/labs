import type { Comparator, Constraint, MetricRef, StateExpr, TemporalOp, Window } from "../../constraints/ast";

/**
 * Where a node sits in a constraint: a slot (`body`, `hold` or `goal`), then
 * the keys down the state tree (`operands`, 1, `cond`, `operand`, `body`, ...).
 */
export type Path = readonly (string | number)[];

export type Connective = "and" | "or";

export type Atom = Extract<StateExpr, { kind: "atom" }>;

/** The names the builder offers when it makes an atom. */
export type Names = { metrics: string[]; places: string[]; transitions: string[] };

/** An empty slot. It has no verdict until it is filled. */
export const HOLE: StateExpr = { kind: "hole" };

export function isHole(expr: StateExpr): boolean {
  return expr.kind === "hole";
}

/** What an add button or a hole's menu makes. */
export type ItemKind = "condition" | "group" | "if" | "iff" | "later";

/** The temporal operator of a top-level constraint, or `now` for none. */
export type TopOp = Constraint["op"];

/** A temporal node nested in a state expression. */
export type NestedTemporal = Extract<StateExpr, { kind: TemporalOp }>;

/** Whether a node is a temporal operator nested in a state expression. */
export function isNestedTemporal(node: StateExpr): node is NestedTemporal {
  return node.kind === "always" || node.kind === "eventually" || node.kind === "until" || node.kind === "weak-until";
}

/** The window a new "+ window" starts from. */
export const DEFAULT_WINDOW: Window = { from: 0, to: 10 };

/** The comparator that says the opposite, so `not (x < 3)` becomes `x >= 3`. */
export const NEGATED: Readonly<Record<Comparator, Comparator>> = {
  "<": ">=",
  "<=": ">",
  ">": "<=",
  ">=": "<",
  "==": "!=",
  "!=": "==",
};

/** A fresh atom: the first metric, else the first place, else the first transition. */
export function defaultAtom(names: Names): Atom {
  const [metric] = names.metrics;
  const [place] = names.places;
  const [transition] = names.transitions;
  const ref: MetricRef =
    metric !== undefined
      ? { kind: "metric", name: metric }
      : place !== undefined
        ? { kind: "count", place }
        : { kind: "fired", transition: transition ?? "" };
  return { kind: "atom", ref, op: ">=", value: 0 };
}

/** The node at a path. */
export function stateAt(constraint: Constraint, path: Path): StateExpr {
  let node: unknown = constraint;
  for (const key of path) {
    node = (node as Record<string | number, unknown> | undefined)?.[key];
  }
  return node as StateExpr;
}

/** Rewrites the node at `rel` below `expr`, copying the nodes on the way. */
function updateIn(expr: StateExpr, rel: Path, change: (node: StateExpr) => StateExpr): StateExpr {
  const [key, index, ...rest] = rel;
  if (key === undefined) {
    return change(expr);
  }
  switch (expr.kind) {
    case "and":
    case "or":
      return {
        ...expr,
        operands: expr.operands.map((operand, at) => (at === index ? updateIn(operand, rest, change) : operand)),
      };
    case "not":
      return { ...expr, operand: updateIn(expr.operand, rel.slice(1), change) };
    case "implies":
    case "iff":
      return key === "left" || key === "right"
        ? { ...expr, [key]: updateIn(expr[key], rel.slice(1), change) }
        : expr;
    case "ite":
      if (key === "cond" || key === "then") {
        return { ...expr, [key]: updateIn(expr[key], rel.slice(1), change) };
      }
      return key === "else" && expr.else ? { ...expr, else: updateIn(expr.else, rel.slice(1), change) } : expr;
    case "always":
    case "eventually":
      return key === "body" ? { ...expr, body: updateIn(expr.body, rel.slice(1), change) } : expr;
    case "until":
    case "weak-until":
      return key === "hold" || key === "goal"
        ? { ...expr, [key]: updateIn(expr[key], rel.slice(1), change) }
        : expr;
    default:
      return expr;
  }
}

/** Rewrites the node at a path. */
export function updateAt(constraint: Constraint, path: Path, change: (node: StateExpr) => StateExpr): Constraint {
  const [slot, ...rel] = path;
  const current = (constraint as unknown as Record<string, StateExpr | undefined>)[String(slot)];
  if (current === undefined) {
    return constraint;
  }
  return { ...constraint, [String(slot)]: updateIn(current, rel, change) } as Constraint;
}

/** The connective of the group a path sits in, when it sits in one. */
function parentConnective(constraint: Constraint, path: Path): Connective | null {
  if (path.length < 2 || path[path.length - 2] !== "operands") {
    return null;
  }
  const parent = stateAt(constraint, path.slice(0, -2));
  return parent.kind === "and" || parent.kind === "or" ? parent.kind : null;
}

/**
 * Wraps the node in a group with a hole beside it. A group of one has no
 * brackets once printed, so the group always holds two. Inside a group it
 * takes the other connective, so the brackets mean something.
 */
export function wrapInGroup(constraint: Constraint, path: Path): Constraint {
  const kind: Connective = parentConnective(constraint, path) === "and" ? "or" : "and";
  return updateAt(constraint, path, (node) => ({ kind, operands: [node, HOLE] }));
}

/** The item an add button makes. A group takes the connective that is not `inside`. */
function makeItem(kind: ItemKind, names: Names, inside: Connective): StateExpr {
  switch (kind) {
    case "condition":
      return defaultAtom(names);
    case "group":
      return { kind: inside === "and" ? "or" : "and", operands: [defaultAtom(names), defaultAtom(names)] };
    case "if":
      return { kind: "ite", cond: defaultAtom(names), then: HOLE };
    case "iff":
      return { kind: "iff", left: defaultAtom(names), right: HOLE };
    case "later":
      return { kind: "eventually", body: HOLE };
  }
}

/** Adds an item to the group at a path. A lone node first becomes a group; a hole just takes the item. */
function append(constraint: Constraint, path: Path, kind: ItemKind, names: Names): Constraint {
  const node = stateAt(constraint, path);
  if (isHole(node)) {
    return updateAt(constraint, path, () => makeItem(kind, names, "and"));
  }
  const grouped =
    node.kind === "and" || node.kind === "or"
      ? constraint
      : updateAt(constraint, path, (lone) => ({ kind: "and", operands: [lone] }));
  return updateAt(grouped, path, (group) =>
    group.kind === "and" || group.kind === "or"
      ? { ...group, operands: [...group.operands, makeItem(kind, names, group.kind)] }
      : group,
  );
}

/** Adds an item of any kind to the list at a path. */
export function addItem(constraint: Constraint, path: Path, kind: ItemKind, names: Names): Constraint {
  return append(constraint, path, kind, names);
}

export function addCondition(constraint: Constraint, path: Path, names: Names): Constraint {
  return append(constraint, path, "condition", names);
}

/** Adds a nested group of two conditions. Its connective is the other one, so the brackets survive the text. */
export function addGroup(constraint: Constraint, path: Path, names: Names): Constraint {
  return append(constraint, path, "group", names);
}

/** Adds an "if … then" block: a condition, and a hole for the consequence. */
export function addIf(constraint: Constraint, path: Path, names: Names): Constraint {
  return append(constraint, path, "if", names);
}

/** Adds an IFF block: a condition, and a hole for the other side. */
export function addIff(constraint: Constraint, path: Path, names: Names): Constraint {
  return append(constraint, path, "iff", names);
}

/** Adds a nested temporal block with a hole for its body. */
export function addLater(constraint: Constraint, path: Path, names: Names): Constraint {
  return append(constraint, path, "later", names);
}

/** Puts an item where the hole at a path is. */
export function fillHole(constraint: Constraint, path: Path, kind: ItemKind, names: Names): Constraint {
  return updateAt(constraint, path, (node) => (isHole(node) ? makeItem(kind, names, "and") : node));
}

/** Adds an ELSE hole to the ite at a path. */
export function addOtherwise(constraint: Constraint, path: Path): Constraint {
  return updateAt(constraint, path, (node) => (node.kind === "ite" ? { ...node, else: HOLE } : node));
}

/**
 * Sets the connective of the group at a path. Every sibling shares it. A
 * nested group that now has the same connective as its parent joins the
 * parent's list, which keeps the meaning and keeps the brackets meaningful.
 */
export function setConnective(constraint: Constraint, path: Path, kind: Connective): Constraint {
  return updateAt(constraint, path, (node) =>
    node.kind === "and" || node.kind === "or"
      ? {
          kind,
          operands: node.operands.flatMap((operand) => (operand.kind === kind ? operand.operands : [operand])),
        }
      : node,
  );
}

/** Replaces the atom at a path. */
export function setAtom(constraint: Constraint, path: Path, atom: Atom): Constraint {
  return updateAt(constraint, path, (node) => (node.kind === "atom" ? atom : node));
}

/** Wraps the node in a `not`, or takes the `not` off a node that has one. */
/**
 * The same meaning without a `not` on top: comparators flip, and/or swap
 * (De Morgan), `not (a implies b)` is `a and not b`, and `not always` is
 * `eventually not`. `null` where no such rewrite reads simpler (iff,
 * if/then, until, a hole).
 */
export function withoutNot(expr: StateExpr): StateExpr | null {
  switch (expr.kind) {
    case "atom":
      return { ...expr, op: NEGATED[expr.op] };
    case "bool":
      return { kind: "bool", value: !expr.value };
    case "not":
      return expr.operand;
    case "and":
    case "or": {
      const operands = expr.operands.map(withoutNot);
      return operands.every((operand) => operand !== null)
        ? { kind: expr.kind === "and" ? "or" : "and", operands: operands as StateExpr[] }
        : null;
    }
    case "implies": {
      const right = withoutNot(expr.right);
      return right === null ? null : { kind: "and", operands: [expr.left, right] };
    }
    case "always":
    case "eventually": {
      const body = withoutNot(expr.body);
      return body === null
        ? null
        : { ...expr, kind: expr.kind === "always" ? "eventually" : "always", body };
    }
    default:
      return null;
  }
}

/** Rewrites the `not` at a path without it, keeping the meaning. Leaves it when no rewrite exists. */
export function rewriteNot(constraint: Constraint, path: Path): Constraint {
  return updateAt(constraint, path, (node) => (node.kind === "not" ? (withoutNot(node.operand) ?? node) : node));
}

/** Removes the node below `expr`; `null` when it leaves nothing, so its parent goes too. */
function removeIn(expr: StateExpr, rel: Path): StateExpr | null {
  const [key, index, ...rest] = rel;
  if (key === undefined) {
    return null;
  }
  switch (expr.kind) {
    case "and":
    case "or": {
      const child = expr.operands[Number(index)];
      if (child === undefined) {
        return expr;
      }
      const kept = removeIn(child, rest);
      const operands =
        kept === null
          ? expr.operands.filter((_, at) => at !== index)
          : expr.operands.map((operand, at) => (at === index ? kept : operand));
      // A group of none goes; a group of one is its condition.
      return operands.length === 0 ? null : operands.length === 1 ? (operands[0] ?? null) : { ...expr, operands };
    }
    case "not": {
      const kept = removeIn(expr.operand, rel.slice(1));
      return kept === null ? null : { ...expr, operand: kept };
    }
    case "implies":
    case "iff":
      return key === "left" || key === "right"
        ? { ...expr, [key]: removeIn(expr[key], rel.slice(1)) ?? HOLE }
        : expr;
    case "ite": {
      if (key === "else") {
        const kept = expr.else ? removeIn(expr.else, rel.slice(1)) : null;
        const { else: _dropped, ...withoutElse } = expr;
        return kept === null ? withoutElse : { ...expr, else: kept };
      }
      return key === "cond" || key === "then" ? { ...expr, [key]: removeIn(expr[key], rel.slice(1)) ?? HOLE } : expr;
    }
    case "always":
    case "eventually":
      return key === "body" ? { ...expr, body: removeIn(expr.body, rel.slice(1)) ?? HOLE } : expr;
    case "until":
    case "weak-until":
      return key === "hold" || key === "goal"
        ? { ...expr, [key]: removeIn(expr[key], rel.slice(1)) ?? HOLE }
        : expr;
    default:
      return expr;
  }
}

/**
 * Removes the node at a path. A group left with none goes too, and one left
 * with one is that one. A slot left with nothing is a hole.
 */
export function removeAt(constraint: Constraint, path: Path): Constraint {
  const [slot, ...rel] = path;
  const current = (constraint as unknown as Record<string, StateExpr | undefined>)[String(slot)];
  if (current === undefined) {
    return constraint;
  }
  return { ...constraint, [String(slot)]: removeIn(current, rel) ?? HOLE } as Constraint;
}

/** A temporal node or constraint with its parts under one shape: a hold, maybe a goal, maybe a window. */
type Parts = { hold: StateExpr; goal: StateExpr | undefined; window: Window | undefined };

function partsOf(node: object): Parts {
  const read = node as { body?: StateExpr; hold?: StateExpr; goal?: StateExpr; window?: Window };
  return { hold: read.hold ?? read.body ?? HOLE, goal: read.goal, window: read.window };
}

/** The fields an operator takes: a body, or a hold and a goal, and the window when it can have one. */
function fieldsFor(op: TemporalOp | "now", parts: Parts): Record<string, unknown> {
  const window = parts.window !== undefined && op !== "now" ? { window: parts.window } : {};
  return op === "until" || op === "weak-until"
    ? { hold: parts.hold, goal: parts.goal ?? HOLE, ...window }
    : { body: parts.hold, ...window };
}

/**
 * Changes the top operator and keeps what was written. Always, eventually or
 * now to until puts the body in `hold` and leaves `goal` a hole. Until to a
 * one-part operator keeps `hold`. Now drops the window.
 */
export function changeOperator(constraint: Constraint, op: TopOp): Constraint {
  if (constraint.op === op) {
    return constraint;
  }
  return { op, ...fieldsFor(op, partsOf(constraint)) } as Constraint;
}

/** Changes the operator of the nested temporal block at a path, keeping its parts and window. */
export function changeNestedOperator(constraint: Constraint, path: Path, op: TemporalOp): Constraint {
  return updateAt(constraint, path, (node) =>
    isNestedTemporal(node) && node.kind !== op
      ? ({ kind: op, ...fieldsFor(op, partsOf(node)) } as StateExpr)
      : node,
  );
}

/** Sets or clears the window of the operator at a path; the empty path is the top operator. */
export function setWindow(constraint: Constraint, path: Path, window: Window | undefined): Constraint {
  const apply = <T extends object>(node: T): T => {
    const { window: _old, ...rest } = node as T & { window?: Window };
    return (window === undefined ? rest : { ...rest, window }) as T;
  };
  if (path.length === 0) {
    return constraint.op === "now" ? constraint : apply(constraint);
  }
  return updateAt(constraint, path, (node) => (isNestedTemporal(node) ? apply(node) : node));
}

/** Whether `path` is `ancestor` or lies below it. */
function isWithin(path: Path, ancestor: Path): boolean {
  return ancestor.length <= path.length && ancestor.every((key, at) => key === path[at]);
}

/** Replaces the node `marker` (by identity) with `node`, wherever it sits below `tree`. */
function substitute(tree: unknown, marker: object, node: StateExpr): unknown {
  if (tree === marker) {
    return node;
  }
  if (Array.isArray(tree)) {
    return tree.map((child) => substitute(child, marker, node));
  }
  if (typeof tree === "object" && tree !== null) {
    return Object.fromEntries(Object.entries(tree).map(([key, child]) => [key, substitute(child, marker, node)]));
  }
  return tree;
}

/** Whether `moveInto` would move the node at `from` into `to`: a node into a hole that is not inside it. */
export function canMoveInto(constraint: Constraint, from: Path, to: Path): boolean {
  const node = stateAt(constraint, from);
  const target = stateAt(constraint, to);
  return (
    node !== undefined && !isHole(node) && from.length >= 2 && !isWithin(to, from) && target !== undefined && isHole(target)
  );
}

/**
 * Moves the node at `from` into the hole at `to`. The hole takes a marker
 * first, so removing `from` can shift the indices of its list without losing
 * the hole; the marker is then swapped for the node. Unchanged when
 * `canMoveInto` says no.
 */
export function moveInto(constraint: Constraint, from: Path, to: Path): Constraint {
  if (!canMoveInto(constraint, from, to)) {
    return constraint;
  }
  const marker = { kind: "hole" } as StateExpr;
  const marked = updateAt(constraint, to, () => marker);
  return substitute(removeAt(marked, from), marker, stateAt(constraint, from)) as Constraint;
}
