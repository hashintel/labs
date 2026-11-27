import { floatLiteral, named, sugarImport } from "./python";

import type { SpnExpr, SpnGraph, SpnModule, SpnSort, SpnVariable } from "../graph/spn-graph";
import type { PrintedModule, PythonProgram } from "./python";

/**
 * The SPN dialect of the Python, in the form of Zeroth's own
 * `birth_death.py`: SPN expressions over the `zrth.sugar` DSL, each
 * variable declared with its SPN sort, and the imports each file needs.
 * The system composes every module with the clocks hidden. `python.ts`
 * writes the rest, `flow` included on a module that has one.
 */

/** Each sort's constructor: the name imported from zrth, and the call that makes the sort. */
const SPN_SORTS: Record<SpnSort, { name: string; call: string }> = {
  nat: { name: "Nat", call: "Nat()" },
  clock: { name: "Clock", call: "Clock()" },
  event: { name: "Event", call: "Event()" },
  bool: { name: "Bool", call: "Bool([1, 1])" },
};

const ROLE_ORDER: SpnVariable["role"][] = ["time", "place", "clock", "event", "pick"];

/** An operand of `&`: a comparison needs parentheses, since `&` binds tighter. */
function logicalOperand(node: SpnExpr, text: string): string {
  return node.kind === "test" || node.kind === "nonNegative" ? `(${text})` : text;
}

/** An operand of `~`, of a test or of a step: anything but a name, a literal or a call. */
function tightOperand(node: SpnExpr, text: string): string {
  return node.kind === "logic" ||
    node.kind === "test" ||
    node.kind === "step" ||
    node.kind === "nonNegative" ||
    node.kind === "rate"
    ? `(${text})`
    : text;
}

/** The expression's text. Each sugar name it prints goes into `used`. */
function expr(node: SpnExpr, used: Set<string>): string {
  const print = (child: SpnExpr) => expr(child, used);
  switch (node.kind) {
    case "ref":
      return node.name;
    case "nat":
      return `${node.value}`;
    case "bool":
      return node.value ? "True" : "False";
    case "test":
      return `${tightOperand(node.operand, print(node.operand))} ${node.zero ? "==" : "!="} 0`;
    case "logic":
      return `${logicalOperand(node.left, print(node.left))} ${node.op} ${logicalOperand(node.right, print(node.right))}`;
    case "not":
      return `~${tightOperand(node.operand, print(node.operand))}`;
    case "step":
      return `${tightOperand(node.operand, print(node.operand))} ${node.op} 1`;
    case "ite":
      return `${named(used, "ite")}(${print(node.condition)}, ${print(node.thenBranch)}, ${print(node.elseBranch)})`;
    case "ifThen":
      return `${named(used, "ite")}(${print(node.condition)}, ${print(node.branch)}, None)`;
    case "fired":
      return `${named(used, "fired")}(${node.event})`;
    case "exp":
      return `${named(used, "exp")}(${floatLiteral(node.rate)})`;
    case "nonNegative":
      return `${node.clock} >= 0`;
    case "rate":
      return `${node.factor} * ${named(used, "d")}(${node.time})`;
    case "zeroFlow":
      return "0";
  }
}

/** The sugar names a body can print, in the order the reference file lists them. */
const SUGAR_NAMES = ["d", "ite", "fired", "exp"];

/** `from zrth import SPN, Clock, Event, Nat, Var`, the sorts the variables take. */
function zrthImport(variables: SpnVariable[]): string {
  const sorts = new Set(variables.map((variable) => variable.sort));
  const constructors = [...sorts].map((sort) => SPN_SORTS[sort].name).toSorted();
  return `from zrth import ${["SPN", ...constructors, "Var"].join(", ")}`;
}

/** The module with its expressions printed, and the names they use. */
function printedModule(module: SpnModule): { printed: PrintedModule; used: Set<string> } {
  const { flow, ...rest } = module;
  const used = new Set<string>();
  const print = (node: SpnExpr) => expr(node, used);
  const printed = {
    ...rest,
    theory: "SPN",
    init: module.init.map(print),
    next: module.next.map((statement) => ({ ...statement, expr: print(statement.expr) })),
    returns: module.returns.map(print),
    ...(flow === undefined ? {} : { flow: flow.map(print) }),
  };
  return {
    printed: { ...printed, file: { imports: [sugarImport(SUGAR_NAMES, used)], sortConstants: [] } },
    used,
  };
}

/** The graph as the shared skeleton writes it. */
export function spnProgram(graph: SpnGraph): PythonProgram {
  const zrth = [zrthImport(graph.variables), "from zrth import Module as compose"];
  const printed = graph.modules.map(printedModule);
  const used = new Set(printed.flatMap((module) => [...module.used]));
  return {
    language: "spn",
    roles: ROLE_ORDER,
    variables: graph.variables.map((variable) => ({
      ...variable,
      sort: SPN_SORTS[variable.sort].call,
    })),
    modules: printed.map((module) => module.printed),
    system: {
      kind: "compose",
      modules: graph.modules.map((module) => module.instance),
      hidden: graph.hidden,
    },
    imports: [...zrth, sugarImport(SUGAR_NAMES, used)],
    mainImports: zrth,
    sortConstants: null,
  };
}
