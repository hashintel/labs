/**
 * The code-parser hook's contract: the trees a parser hands back for the
 * IR's code strings.
 *
 * Input: one code string and the surface it is read as: `lambda` for a
 * guard or a rate, `kernel`, or `dynamics`. The string is a bare body of
 * TypeScript ending in `return`, with `input` (or `tokens` for dynamics)
 * ambient and every constant already inlined.
 *
 * Output: a `CodeFunction` built from the node kinds below, or `undefined`,
 * which refuses the item with `code-not-parsed`. A construct outside these
 * kinds is the parser's to refuse, by returning `undefined`. The parser
 * need not fold constants: the translation to linear expressions folds
 * constant arithmetic itself.
 *
 * A parser is pure and synchronous, and does not throw. The tree is an
 * expression: `let` bindings, conditionals and `map` comprehensions instead
 * of statements and loops, and distributions as nodes of their own. It
 * carries no ids, spans or types, since nothing reads them.
 */

export type CodeSurface = "lambda" | "kernel" | "dynamics";

/** Reads one code string into a tree, or `undefined` when it cannot. */
export type CodeParser = (code: string, surface: CodeSurface) => CodeFunction | undefined;

export type CodeFunction = {
  /** The input object first: `input` for a guard, rate or kernel, `tokens` for dynamics. */
  params: { name: string }[];
  body: CodeExpr;
};

export type CodeBinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "**"
  | "<"
  | "<="
  | ">"
  | ">="
  | "=="
  | "!="
  | "&&"
  | "||";

export type CodeUnaryOp = "-" | "+" | "!";

/** The `Math` functions a tree can call. */
export type CodeMathFn =
  | "abs"
  | "acos"
  | "asin"
  | "atan"
  | "atan2"
  | "cbrt"
  | "ceil"
  | "cos"
  | "cosh"
  | "exp"
  | "floor"
  | "hypot"
  | "log"
  | "log10"
  | "log2"
  | "max"
  | "min"
  | "pow"
  | "random"
  | "round"
  | "sign"
  | "sin"
  | "sinh"
  | "sqrt"
  | "tan"
  | "tanh"
  | "trunc";

export type CodeDistributionKind = "gaussian" | "uniform" | "lognormal";

export type CodeExpr =
  | { kind: "numberLit"; value: number }
  | { kind: "boolLit"; value: boolean }
  | { kind: "stringLit"; value: string }
  /** `Math.PI`, `Math.E`, `Infinity` or `NaN`. */
  | { kind: "constant"; name: "PI" | "E" | "Infinity" | "NaN" }
  /** A function parameter, a `const` or a `map` callback's parameter. */
  | { kind: "localRef"; name: string }
  /** `target.field` or `target["field"]`. */
  | { kind: "fieldAccess"; target: CodeExpr; field: string }
  /** `target[index]`. */
  | { kind: "indexAccess"; target: CodeExpr; index: CodeExpr }
  /** `target.length`. */
  | { kind: "length"; target: CodeExpr }
  | { kind: "unary"; op: CodeUnaryOp; operand: CodeExpr }
  | { kind: "binary"; op: CodeBinaryOp; left: CodeExpr; right: CodeExpr }
  /** `condition ? thenBranch : elseBranch`. */
  | { kind: "cond"; condition: CodeExpr; thenBranch: CodeExpr; elseBranch: CodeExpr }
  /** `const` statements in order, then the `return`. */
  | { kind: "let"; bindings: { name: string; value: CodeExpr }[]; body: CodeExpr }
  | { kind: "mathCall"; fn: CodeMathFn; args: CodeExpr[] }
  | { kind: "recordLit"; entries: { key: string; value: CodeExpr }[] }
  | { kind: "arrayLit"; elements: CodeExpr[] }
  /** `target.map((param) => body)`. */
  | { kind: "arrayMap"; target: CodeExpr; param: { name: string }; body: CodeExpr }
  /** `Distribution.Gaussian(mean, deviation)` and the like. */
  | { kind: "distribution"; dist: CodeDistributionKind; args: CodeExpr[] }
  /** `base.map((param) => body)` over a distribution. */
  | { kind: "distributionMap"; base: CodeExpr; param: { name: string }; body: CodeExpr };
