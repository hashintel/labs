import type { CodeBinaryOp, CodeExpr, CodeFunction } from "../code/code-tree";

/** Small builders for code trees a test writes by hand, without a captured parse. */

export function lit(value: number): CodeExpr {
  return { kind: "numberLit", value };
}

export function text(value: string): CodeExpr {
  return { kind: "stringLit", value };
}

export function local(name: string): CodeExpr {
  return { kind: "localRef", name };
}

/** `input.<place>[index]`: a bound token. */
export function token(place: string, index: number): CodeExpr {
  return {
    kind: "indexAccess",
    target: { kind: "fieldAccess", target: local("input"), field: place },
    index: lit(index),
  };
}

export function record(entries: Record<string, CodeExpr>): CodeExpr {
  return {
    kind: "recordLit",
    entries: Object.entries(entries).map(([key, value]) => ({ key, value })),
  };
}

export function array(...elements: CodeExpr[]): CodeExpr {
  return { kind: "arrayLit", elements };
}

/** `input.<place>[index].<attribute>`: one attribute of a bound token. */
export function tokenAttribute(place: string, index: number, attribute: string): CodeExpr {
  return { kind: "fieldAccess", target: token(place, index), field: attribute };
}

export function op(left: CodeExpr, operator: CodeBinaryOp, right: CodeExpr): CodeExpr {
  return { kind: "binary", op: operator, left, right };
}

/** A guard, rate or kernel over `input`. */
export function lambdaOf(body: CodeExpr): CodeFunction {
  return { params: [{ name: "input" }], body };
}

/** Dynamics over `tokens`. */
export function dynamicsOf(body: CodeExpr): CodeFunction {
  return { params: [{ name: "tokens" }], body };
}
