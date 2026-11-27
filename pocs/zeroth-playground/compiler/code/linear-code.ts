import {
  binary,
  bool,
  ite,
  max,
  min,
  not,
  num,
  type LinearExpr,
  relu,
  scale,
} from "../graph/linear-graph";
import { refuse } from "../diagnostics";

import type { DiagnosticCode } from "../diagnostics";
import type { CodeDistributionKind, CodeExpr, CodeFunction } from "./code-tree";

/**
 * Translates the linear subset of a code tree to linear expressions:
 * sums, scaling by a constant, comparisons, Boolean logic, conditionals,
 * `Math.max`, `Math.min` and `Math.abs` through `relu`, string attributes
 * as codes, and distributions through inputs the harness draws. Arithmetic
 * on two constants is folded, so a parser need not fold it. Everything the
 * theories cannot express throws a `Refusal`, which the caller reports
 * against its item.
 */

/** What a token attribute read resolves to. */
export type AttributeValue = {
  expr: LinearExpr;
  sort: "number" | "boolean" | "string";
  /** A string attribute's values, whose indices its expression holds. */
  codes?: readonly string[];
};

/** An attribute the theories cannot hold, refused where the code reads it. */
export type AttributeRefusal = { refused: DiagnosticCode; message: string };

export type TokenBinding = {
  /**
   * The value of one attribute, its refusal when the theories cannot hold
   * it, or `undefined` when the colour has no such attribute.
   */
  attribute: (name: string) => AttributeValue | AttributeRefusal | undefined;
};

export type LinearCodeEnv = {
  /** The function's input object: `input` for guards, rates and kernels, `tokens` for dynamics. */
  inputName: string;
  /** `input.<Place>[index]`, or `undefined` when the place is not bound. */
  token: (place: string, index: number) => TokenBinding | undefined;
  /** `input.<Place>.length`, the arc weight. */
  tokenCount: (place: string) => number | undefined;
  /**
   * A distribution as a value: an input the harness draws each step, or
   * `undefined` when the draw cannot be an input (a token-dependent spread).
   */
  sample?: (kind: CodeDistributionKind, args: readonly Translated[]) => LinearExpr | undefined;
};

export type Translated = AttributeValue;

function number(expr: LinearExpr): Translated {
  return { expr, sort: "number" };
}
function boolean(expr: LinearExpr): Translated {
  return { expr, sort: "boolean" };
}

function asNumber(value: Translated): LinearExpr {
  return value.sort === "number"
    ? value.expr
    : refuse("sort-mismatch", `a ${value.sort} is used where a number is needed`);
}

function asBoolean(value: Translated): LinearExpr {
  return value.sort === "boolean"
    ? value.expr
    : refuse("sort-mismatch", `a ${value.sort} is used where a boolean is needed`);
}

function constantOf(expr: LinearExpr): number | undefined {
  return expr.kind === "num" ? expr.value : undefined;
}

/** `factor * operand`, folding a scale of a scale and of a constant. */
export function scaled(factor: number, operand: LinearExpr): LinearExpr {
  if (operand.kind === "num") {
    return num(factor * operand.value);
  }
  if (operand.kind === "scale") {
    return scale(factor * operand.factor, operand.operand);
  }
  return factor === 1 ? operand : scale(factor, operand);
}

type Scope = {
  env: LinearCodeEnv;
  /** `const` names in scope, to their values or the tokens they alias. */
  locals: ReadonlyMap<string, Translated | TokenBinding>;
};

function isToken(value: Translated | TokenBinding): value is TokenBinding {
  return "attribute" in value;
}

/** The token an expression denotes, when it denotes one. */
function resolveToken(node: CodeExpr, scope: Scope): TokenBinding | undefined {
  if (node.kind === "localRef") {
    const local = scope.locals.get(node.name);
    return local !== undefined && isToken(local) ? local : undefined;
  }
  if (
    node.kind === "indexAccess" &&
    node.target.kind === "fieldAccess" &&
    node.target.target.kind === "localRef" &&
    node.target.target.name === scope.env.inputName &&
    node.index.kind === "numberLit"
  ) {
    return scope.env.token(node.target.field, node.index.value);
  }
  return undefined;
}

/** Equality on codes, numbers or Bools, as `==` or `!=`. */
function equality(negate: boolean, left: Translated, right: Translated): Translated {
  if (left.sort === "boolean" && right.sort === "boolean") {
    const same = binary(
      "|",
      binary("&", left.expr, right.expr),
      binary("&", not(left.expr), not(right.expr)),
    );
    return boolean(negate ? not(same) : same);
  }
  if (left.sort === "string" && right.sort === "string") {
    const leftCodes = left.codes ?? [];
    const rightCodes = right.codes ?? [];
    if (
      leftCodes.length !== rightCodes.length ||
      leftCodes.some((code, index) => rightCodes[index] !== code)
    ) {
      return refuse(
        "string-codes-differ",
        "the two string attributes take different sets of values, so their codes cannot be compared; compare each with a literal instead",
      );
    }
  } else if (left.sort !== right.sort) {
    return refuse("sort-mismatch", `a ${left.sort} is compared with a ${right.sort}`);
  }
  return boolean(binary(negate ? "!=" : "==", left.expr, right.expr));
}

function translate(node: CodeExpr, scope: Scope): Translated {
  switch (node.kind) {
    case "numberLit":
      return number(num(node.value));
    case "boolLit":
      return boolean(bool(node.value));
    case "stringLit":
      return refuse(
        "string-as-value",
        "a string literal can only be compared with a string attribute",
      );
    case "constant":
      switch (node.name) {
        case "PI":
          return number(num(Math.PI));
        case "E":
          return number(num(Math.E));
        default:
          return refuse(
            "non-finite-constant",
            `${node.name} is not a finite number, so it has no value in the linear theories`,
          );
      }
    case "localRef": {
      const local = scope.locals.get(node.name);
      if (local === undefined) {
        return refuse("unbound-local", `${node.name} is not defined in this code`);
      }
      if (isToken(local)) {
        return refuse(
          "token-as-value",
          `${node.name} is a whole token; read one of its attributes`,
        );
      }
      return local;
    }
    case "fieldAccess": {
      const token = resolveToken(node.target, scope);
      if (token === undefined) {
        return refuse("unknown-field", `${node.field} is read from a value that is not a token`);
      }
      const value = token.attribute(node.field);
      if (value === undefined) {
        return refuse("unknown-attribute", `the token has no attribute named ${node.field}`);
      }
      return "refused" in value ? refuse(value.refused, value.message) : value;
    }
    case "indexAccess":
      return refuse(
        "token-as-value",
        "a whole token is used as a value; read one of its attributes",
      );
    case "length": {
      const target = node.target;
      if (
        target.kind === "fieldAccess" &&
        target.target.kind === "localRef" &&
        target.target.name === scope.env.inputName
      ) {
        const count = scope.env.tokenCount(target.field);
        if (count !== undefined) {
          return number(num(count));
        }
      }
      return refuse("unknown-length", ".length is only known for an input place");
    }
    case "unary": {
      const operand = translate(node.operand, scope);
      switch (node.op) {
        case "-":
          return number(scaled(-1, asNumber(operand)));
        case "+":
          return number(asNumber(operand));
        case "!":
          return boolean(not(asBoolean(operand)));
      }
    }
    case "binary": {
      if (node.op === "==" || node.op === "!=") {
        // A string literal takes the code of the attribute it meets.
        const negate = node.op === "!=";
        const literal =
          node.left.kind === "stringLit"
            ? node.left
            : node.right.kind === "stringLit"
              ? node.right
              : undefined;
        if (literal !== undefined) {
          const other = literal === node.left ? node.right : node.left;
          const attribute = translate(other, scope);
          if (attribute.sort !== "string") {
            return refuse("sort-mismatch", `a string is compared with a ${attribute.sort}`);
          }
          const code = attribute.codes?.indexOf(literal.value) ?? -1;
          if (code === -1) {
            // A value the attribute never takes: the comparison is decided.
            return boolean(bool(negate));
          }
          return boolean(binary(negate ? "!=" : "==", attribute.expr, num(code)));
        }
        return equality(negate, translate(node.left, scope), translate(node.right, scope));
      }
      const left = translate(node.left, scope);
      const right = translate(node.right, scope);
      switch (node.op) {
        case "+":
        case "-": {
          const leftValue = asNumber(left);
          const rightValue = asNumber(right);
          const leftConstant = constantOf(leftValue);
          const rightConstant = constantOf(rightValue);
          if (leftConstant !== undefined && rightConstant !== undefined) {
            return number(
              num(node.op === "+" ? leftConstant + rightConstant : leftConstant - rightConstant),
            );
          }
          return number(binary(node.op, leftValue, rightValue));
        }
        case "*": {
          const leftValue = asNumber(left);
          const rightValue = asNumber(right);
          const leftConstant = constantOf(leftValue);
          const rightConstant = constantOf(rightValue);
          if (leftConstant !== undefined) {
            return number(scaled(leftConstant, rightValue));
          }
          if (rightConstant !== undefined) {
            return number(scaled(rightConstant, leftValue));
          }
          return refuse(
            "nonlinear-product",
            "two values the tokens decide are multiplied; the linear theories add, subtract, scale by a constant and compare",
          );
        }
        case "/": {
          const divisor = constantOf(asNumber(right));
          if (divisor === undefined || divisor === 0) {
            return refuse(
              "nonlinear-division",
              "a value is divided by one the tokens decide; the linear theories only divide by a non-zero constant",
            );
          }
          return number(scaled(1 / divisor, asNumber(left)));
        }
        case "%":
        case "**":
          return refuse(
            "nonlinear-power",
            `a value is raised to a power (${node.op}); the linear theories add, subtract, scale by a constant and compare`,
          );
        case "<":
        case "<=":
        case ">":
        case ">=":
          return boolean(binary(node.op, asNumber(left), asNumber(right)));
        case "&&":
          return boolean(binary("&", asBoolean(left), asBoolean(right)));
        case "||":
          return boolean(binary("|", asBoolean(left), asBoolean(right)));
      }
    }
    case "cond": {
      const condition = asBoolean(translate(node.condition, scope));
      const thenBranch = translate(node.thenBranch, scope);
      const elseBranch = translate(node.elseBranch, scope);
      if (thenBranch.sort !== elseBranch.sort) {
        return refuse("sort-mismatch", "the two branches of the conditional have different sorts");
      }
      return {
        expr: ite(condition, thenBranch.expr, elseBranch.expr),
        sort: thenBranch.sort,
        ...(thenBranch.codes === undefined ? {} : { codes: thenBranch.codes }),
      };
    }
    case "let": {
      const locals = new Map(scope.locals);
      for (const binding of node.bindings) {
        const token = resolveToken(binding.value, { ...scope, locals });
        locals.set(binding.name, token ?? translate(binding.value, { ...scope, locals }));
      }
      return translate(node.body, { ...scope, locals });
    }
    case "mathCall": {
      const args = node.args.map((arg) => asNumber(translate(arg, scope)));
      switch (node.fn) {
        case "max":
          return number(args.reduce((left, right) => max(left, right)));
        case "min":
          return number(args.reduce((left, right) => min(left, right)));
        case "abs": {
          const [operand] = args;
          return operand === undefined
            ? refuse("nonlinear-math", "Math.abs takes one argument")
            : number(binary("+", relu(operand), relu(scaled(-1, operand))));
        }
        case "random":
          return refuse(
            "math-random",
            "Math.random cannot run in a module; use a Distribution, which becomes an input the harness draws",
          );
        default:
          return refuse(
            "nonlinear-math",
            `Math.${node.fn} of a value the tokens decide has no linear form; the linear theories add, subtract, scale by a constant and compare`,
          );
      }
    }
    case "distribution": {
      const args = node.args.map((arg) => translate(arg, scope));
      const drawn = scope.env.sample?.(node.dist, args);
      return drawn === undefined
        ? refuse(
            "distribution-unsupported",
            `a ${node.dist} draw cannot be an input here; the harness draws Uniform and Gaussian with constant spreads`,
          )
        : number(drawn);
    }
    case "distributionMap": {
      const base = translate(node.base, scope);
      const locals = new Map(scope.locals);
      locals.set(node.param.name, base);
      return translate(node.body, { ...scope, locals });
    }
    case "arrayMap":
    case "arrayLit":
    case "recordLit":
      return refuse(
        "array-in-expression",
        "an array or record is not a value the theories hold; read one element or field",
      );
  }
}

/** The function's body as a reactive expression, with its result sort. */
function translateCodeBody(fn: CodeFunction, env: LinearCodeEnv): Translated {
  return translate(fn.body, { env, locals: new Map() });
}

/** A guard: the body must be a Bool. */
export function translateGuard(fn: CodeFunction, env: LinearCodeEnv): LinearExpr {
  return asBoolean(translateCodeBody(fn, env));
}

/** A rate: the body must be a number. */
export function translateRate(fn: CodeFunction, env: LinearCodeEnv): LinearExpr {
  return asNumber(translateCodeBody(fn, env));
}

/** An expression of the body, for a kernel's attribute write or a derivative. */
export function translateValue(
  node: CodeExpr,
  env: LinearCodeEnv,
  locals: ReadonlyMap<string, Translated | TokenBinding> = new Map(),
): Translated {
  return translate(node, { env, locals });
}

/** Resolves a token expression under the caller's locals, for kernels reading `input.P[i]`. */
export function resolveTokenExpr(
  node: CodeExpr,
  env: LinearCodeEnv,
  locals: ReadonlyMap<string, Translated | TokenBinding> = new Map(),
): TokenBinding | undefined {
  return resolveToken(node, { env, locals });
}
