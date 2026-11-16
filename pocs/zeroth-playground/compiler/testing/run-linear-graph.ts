import { pickName } from "../lower/names";

import type { LinearExpr, LinearModule, LinearGraph } from "../graph/linear-graph";

import type { ModuleGraph } from "../graph/module-graph";

/**
 * Runs a reactive module graph the way Zeroth's evaluator runs a composed
 * module: every round, each module's `next` is evaluated once, in an
 * order where a module comes after the drivers of the variables it awaits,
 * and the next values are latched together at the end of the round. The
 * inputs are read from the harness each round; a pick the harness leaves
 * undriven is true, the deterministic sweep.
 *
 * Test support only: the tests use it to check that two shapes of the same
 * net produce the same trace. An SPN graph runs clocks in continuous time,
 * which the rounds do not model, so it is refused.
 */

/** What the name coiner writes before a transition's name to name its pick. */
const PICK_PREFIX = pickName("");

function linearGraph(graph: ModuleGraph): LinearGraph {
  if (graph.language === "spn") {
    throw new Error(
      "an SPN graph runs clocks in continuous time, which the interpreter does not model; lower with rates: coin to interpret it",
    );
  }
  return graph;
}

export type LinearValue = number | boolean;

export type RunLinearGraphOptions = {
  steps: number;
  /**
   * The value of an input for a round; rounds count from 1. `undefined`
   * lets a pick fall to `true`; every other input needs a value.
   */
  inputs: (step: number, name: string) => LinearValue | undefined;
};

/** The variables' values after `init`, then after each round. */
export type Trajectory = Record<string, LinearValue>[];

function driversOf(graph: LinearGraph): Map<string, LinearModule> {
  const drivers = new Map<string, LinearModule>();
  for (const module of graph.modules) {
    for (const name of module.ctrl) {
      const other = drivers.get(name);
      if (other !== undefined) {
        throw new Error(`${name} is driven by both ${other.className} and ${module.className}`);
      }
      drivers.set(name, module);
    }
  }
  for (const variable of graph.variables) {
    const driver = drivers.get(variable.name);
    if (variable.role === "input" && driver !== undefined) {
      throw new Error(`input ${variable.name} is driven by ${driver.className}`);
    }
    if (variable.role !== "input" && driver === undefined) {
      throw new Error(`${variable.name} has no driver`);
    }
  }
  return drivers;
}

/** The names of the variables an expression awaits (`next` references). */
function awaitedNames(expr: LinearExpr, into: Set<string>): void {
  switch (expr.kind) {
    case "ref":
      if (expr.next) {
        into.add(expr.name);
      }
      return;
    case "num":
    case "bool":
      return;
    case "binary":
      awaitedNames(expr.left, into);
      awaitedNames(expr.right, into);
      return;
    case "ite":
      awaitedNames(expr.condition, into);
      awaitedNames(expr.thenBranch, into);
      awaitedNames(expr.elseBranch, into);
      return;
    case "not":
    case "scale":
    case "relu":
      awaitedNames(expr.operand, into);
  }
}

/** Every variable a module awaits, over its `next` and `returns`. */
export function moduleAwaits(module: LinearModule): Set<string> {
  const names = new Set<string>();
  for (const statement of module.next) {
    if (statement.kind === "assign") {
      awaitedNames(statement.expr, names);
    }
  }
  for (const expr of module.returns) {
    awaitedNames(expr, names);
  }
  return names;
}

/**
 * The modules in an order every await can be met in: a module after the
 * drivers of the variables it awaits. Throws when the awaits form a cycle,
 * which composition would reject too.
 */
export function orderLinearModules(lowered: ModuleGraph): LinearModule[] {
  const graph = linearGraph(lowered);
  const drivers = driversOf(graph);
  const inputs = new Set(
    graph.variables
      .filter((variable) => variable.role === "input")
      .map((variable) => variable.name),
  );
  const waitsOn = new Map<LinearModule, Set<LinearModule>>();
  for (const module of graph.modules) {
    const upstream = new Set<LinearModule>();
    for (const name of moduleAwaits(module)) {
      if (inputs.has(name)) {
        continue;
      }
      const driver = drivers.get(name);
      if (driver === undefined) {
        throw new Error(`${module.className} awaits ${name}, which nothing drives`);
      }
      if (driver !== module) {
        upstream.add(driver);
      }
    }
    waitsOn.set(module, upstream);
  }
  const ordered: LinearModule[] = [];
  const placed = new Set<LinearModule>();
  let remaining = graph.modules;
  while (remaining.length > 0) {
    const ready = remaining.filter((module) =>
      [...(waitsOn.get(module) ?? [])].every((upstream) => placed.has(upstream)),
    );
    if (ready.length === 0) {
      throw new Error(
        `the awaits form a cycle through ${remaining.map((module) => module.className).join(", ")}`,
      );
    }
    for (const module of ready) {
      ordered.push(module);
      placed.add(module);
    }
    remaining = remaining.filter((module) => !placed.has(module));
  }
  return ordered;
}

type Scope = {
  /** Locals of the module being evaluated, over the latched values it reads. */
  locals: Map<string, LinearValue>;
  /** A variable's next value: an input's for this round, or its driver's. */
  awaited: (name: string) => LinearValue;
};

function asNumber(value: LinearValue, where: string): number {
  if (typeof value !== "number") {
    throw new TypeError(`${where} expects a number, got ${String(value)}`);
  }
  return value;
}

function asBoolean(value: LinearValue, where: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${where} expects a Bool, got ${String(value)}`);
  }
  return value;
}

function evaluate(node: LinearExpr, scope: Scope): LinearValue {
  switch (node.kind) {
    case "ref": {
      if (node.next) {
        return scope.awaited(node.name);
      }
      const value = scope.locals.get(node.name);
      if (value === undefined) {
        throw new Error(`${node.name} is read but not in scope`);
      }
      return value;
    }
    case "num":
      return node.value;
    case "bool":
      return node.value;
    case "binary": {
      const left = evaluate(node.left, scope);
      const right = evaluate(node.right, scope);
      switch (node.op) {
        case "+":
          return asNumber(left, "+") + asNumber(right, "+");
        case "-":
          return asNumber(left, "-") - asNumber(right, "-");
        case "<":
          return asNumber(left, "<") < asNumber(right, "<");
        case "<=":
          return asNumber(left, "<=") <= asNumber(right, "<=");
        case ">":
          return asNumber(left, ">") > asNumber(right, ">");
        case ">=":
          return asNumber(left, ">=") >= asNumber(right, ">=");
        case "==":
          return left === right;
        case "!=":
          return left !== right;
        case "&":
          return asBoolean(left, "&") && asBoolean(right, "&");
        case "|":
          return asBoolean(left, "|") || asBoolean(right, "|");
      }
      break;
    }
    case "ite":
      return asBoolean(evaluate(node.condition, scope), "ite")
        ? evaluate(node.thenBranch, scope)
        : evaluate(node.elseBranch, scope);
    case "not":
      return !asBoolean(evaluate(node.operand, scope), "~");
    case "scale":
      return node.factor * asNumber(evaluate(node.operand, scope), "*");
    case "relu":
      return Math.max(0, asNumber(evaluate(node.operand, scope), "relu"));
  }
}

function noAwait(name: string): LinearValue {
  throw new Error(`${name} is awaited where nothing is computed yet`);
}

export function runLinearGraph(
  lowered: ModuleGraph,
  { steps, inputs }: RunLinearGraphOptions,
): Trajectory {
  const graph = linearGraph(lowered);
  const ordered = orderLinearModules(graph);
  const inputNames = new Set(
    graph.variables
      .filter((variable) => variable.role === "input")
      .map((variable) => variable.name),
  );
  const state = new Map<string, LinearValue>();
  for (const module of ordered) {
    module.ctrl.forEach((name, index) => {
      const init = module.init[index];
      if (init === undefined) {
        throw new Error(`${module.className} has no init for ${name}`);
      }
      state.set(name, evaluate(init, { locals: new Map(), awaited: noAwait }));
    });
  }
  function snapshot(): Record<string, LinearValue> {
    return Object.fromEntries(state);
  }
  const trace: Trajectory = [snapshot()];
  for (let step = 1; step <= steps; step++) {
    const nextValues = new Map<string, LinearValue>();
    function awaited(name: string): LinearValue {
      if (inputNames.has(name)) {
        const value = inputs(step, name);
        if (value !== undefined) {
          return value;
        }
        if (name.startsWith(PICK_PREFIX)) {
          return true;
        }
        throw new Error(`${name} has no value for round ${step}`);
      }
      const value = nextValues.get(name);
      if (value === undefined) {
        throw new Error(`${name} is awaited before its driver ran`);
      }
      return value;
    }
    for (const module of ordered) {
      const locals = new Map<string, LinearValue>();
      for (const name of [...module.ctrl, ...module.extl]) {
        if (inputNames.has(name)) {
          continue;
        }
        const value = state.get(name);
        if (value === undefined) {
          throw new Error(`${module.className} reads ${name}, which has no value`);
        }
        locals.set(name, value);
      }
      const scope: Scope = { locals, awaited };
      for (const statement of module.next) {
        if (statement.kind === "assign") {
          locals.set(statement.target, evaluate(statement.expr, scope));
        }
      }
      module.ctrl.forEach((name, index) => {
        const value = module.returns[index];
        if (value === undefined) {
          throw new Error(`${module.className} returns nothing for ${name}`);
        }
        nextValues.set(name, evaluate(value, scope));
      });
    }
    for (const [name, value] of nextValues) {
      state.set(name, value);
    }
    trace.push(snapshot());
  }
  return trace;
}
