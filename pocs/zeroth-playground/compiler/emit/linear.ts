import { sortConstantProvenance } from "./describe";
import { floatLiteral, named, sugarImport } from "./python";
import { traced } from "./python-writer";

import type {
  LinearExpr,
  LinearGraph,
  LinearModule,
  LinearSort,
  LinearVariable,
  Theory,
} from "../graph/linear-graph";
import type { PrintedModule, PrintedStatement, PythonProgram } from "./python";
import type { PythonLine } from "./python-writer";

/**
 * The linear dialect of the Python: LIA and LRA expressions over the
 * `zrth.sugar` DSL, the sort constants every variable is declared with,
 * and the imports each file needs. `python.ts` writes the rest.
 */

const SORT_CONSTANTS: Record<LinearSort, { name: string; ctor: string }> = {
  int: { name: "INT", ctor: "Int" },
  real: { name: "REAL", ctor: "Real" },
  bool: { name: "BOOL", ctor: "Bool" },
};

const SORT_ORDER: LinearSort[] = ["int", "real", "bool"];
const ROLE_ORDER: LinearVariable["role"][] = ["place", "input", "flag"];

/** The sugar names a body can print, in the order the import lists them. */
const SUGAR_NAMES = ["X", "ite"];

/** A Python literal: integers become floats where every sort is Real. */
function literal(value: number, asFloat: boolean): string {
  return asFloat ? floatLiteral(value) : `${value}`;
}

const COMPARISONS = new Set(["<", "<=", ">", ">=", "==", "!="]);
const LOGICAL = new Set(["&", "|"]);

/**
 * An operand of `&` or `|`: a comparison or the other logical operator
 * needs parentheses under Python's precedence, where `&` and `|` bind
 * tighter than comparisons.
 */
function logicalOperand(node: LinearExpr, text: string, parent: "&" | "|"): string {
  return node.kind === "binary" &&
    (COMPARISONS.has(node.op) || (LOGICAL.has(node.op) && node.op !== parent))
    ? `(${text})`
    : text;
}

/** An operand of `~` or of a scale: anything but a name, a literal or a call. */
function tightOperand(node: LinearExpr, text: string): string {
  return node.kind === "binary" ? `(${text})` : text;
}

function isLiteral(node: LinearExpr): boolean {
  return node.kind === "num" || node.kind === "bool";
}

/**
 * The expression's text. Each sugar or zrth name it prints goes into
 * `used`, and so does the sort constant a literal-only branch names.
 */
function expr(node: LinearExpr, theory: Theory, used: Set<string>): string {
  const asFloat = theory === "LRA";
  const print = (child: LinearExpr) => expr(child, theory, used);
  switch (node.kind) {
    case "ref":
      return node.next ? `${named(used, "X")}(${node.name})` : node.name;
    case "num":
      return literal(node.value, asFloat);
    case "bool":
      return node.value ? "True" : "False";
    case "binary": {
      const left = print(node.left);
      const right = print(node.right);
      return node.op === "&" || node.op === "|"
        ? `${logicalOperand(node.left, left, node.op)} ${node.op} ${logicalOperand(node.right, right, node.op)}`
        : `${left} ${node.op} ${right}`;
    }
    case "ite": {
      // The sugar needs one branch to carry the theory and sort when both are literals.
      const thenText = print(node.thenBranch);
      const sort = node.thenBranch.kind === "bool" ? "BOOL" : asFloat ? "REAL" : "INT";
      const thenBranch =
        isLiteral(node.thenBranch) && isLiteral(node.elseBranch)
          ? `${named(used, "expr")}(${thenText}, theory=${theory}, sort=${named(used, sort)})`
          : thenText;
      return `${named(used, "ite")}(${print(node.condition)}, ${thenBranch}, ${print(node.elseBranch)})`;
    }
    case "not":
      return `~${tightOperand(node.operand, print(node.operand))}`;
    case "scale":
      return `${literal(node.factor, asFloat)} * ${tightOperand(node.operand, print(node.operand))}`;
    case "relu":
      return `${named(used, "relu")}(${print(node.operand)})`;
  }
}

function theoriesOf(modules: LinearModule[]): Theory[] {
  return [...new Set(modules.map((module) => module.theory))].toSorted();
}

function sortsOf(variables: LinearVariable[]): LinearSort[] {
  return SORT_ORDER.filter((sort) => variables.some((variable) => variable.sort === sort));
}

function constructorNames(sorts: LinearSort[]): string[] {
  return sorts.map((sort) => SORT_CONSTANTS[sort].ctor).toSorted();
}

function sortConstant(sort: LinearSort): PythonLine {
  const { name, ctor } = SORT_CONSTANTS[sort];
  return traced(`${name} = ${ctor}([1, 1])`, sortConstantProvenance(ctor));
}

/** `relu` is the one name the bodies take from `zrth.expr`. */
function reluImport(used: ReadonlySet<string>): string[] {
  return used.has("relu") ? ["from zrth.expr import relu"] : [];
}

/** The imports and sort constants of a module's own file. */
function moduleFile(theory: Theory, used: ReadonlySet<string>): PrintedModule["file"] {
  // A literal-only branch names the module's theory and a sort, which the
  // file declares for itself: zrth sorts compare by shape, not identity.
  const literalSorts = SORT_ORDER.filter((sort) => used.has(SORT_CONSTANTS[sort].name));
  return {
    imports: [
      ...(literalSorts.length > 0
        ? [`from zrth import ${[theory, ...constructorNames(literalSorts), "expr"].join(", ")}`]
        : []),
      ...reluImport(used),
      sugarImport(SUGAR_NAMES, used),
    ],
    sortConstants: literalSorts.map(sortConstant),
  };
}

/** The module with its expressions printed, and the names they use. */
function printedModule(module: LinearModule): { printed: PrintedModule; used: Set<string> } {
  const { theory } = module;
  const used = new Set<string>();
  const print = (node: LinearExpr) => expr(node, theory, used);
  const init = module.init.map(print);
  const next = module.next.map((statement): PrintedStatement =>
    statement.kind === "comment" ? statement : { ...statement, expr: print(statement.expr) },
  );
  const returns = module.returns.map(print);
  return { printed: { ...module, init, next, returns, file: moduleFile(theory, used) }, used };
}

/** The graph as the shared skeleton writes it. */
export function linearProgram(graph: LinearGraph): PythonProgram {
  const sorts = sortsOf(graph.variables);
  const printed = graph.modules.map(printedModule);
  const used = new Set(printed.flatMap((module) => [...module.used]));
  const compose = graph.root.kind === "compose" ? ["from zrth import Module as compose"] : [];
  return {
    language: "linear",
    roles: ROLE_ORDER,
    variables: graph.variables.map((variable) => ({
      ...variable,
      sort: SORT_CONSTANTS[variable.sort].name,
    })),
    modules: printed.map((module) => module.printed),
    system:
      graph.root.kind === "single"
        ? graph.root
        : { kind: "compose", modules: graph.root.modules, hidden: [] },
    imports: [
      `from zrth import ${[...theoriesOf(graph.modules), ...constructorNames(sorts), "Var", ...(used.has("expr") ? ["expr"] : [])].join(", ")}`,
      ...compose,
      ...reluImport(used),
      sugarImport(SUGAR_NAMES, used),
    ],
    mainImports: [
      `from zrth import ${[...theoriesOf(graph.modules), ...constructorNames(sorts), "Var"].join(", ")}`,
      ...compose,
    ],
    sortConstants: sorts.map(sortConstant),
  };
}
