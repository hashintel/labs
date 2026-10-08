import { ParseError, advance, createStream, describe, expectPunct, isPunct, peek } from "./tokenizer";

import type { MetricExpr, MetricRef } from "./ast";
import type { Diagnostic } from "./diagnostics";
import type { TokenStream } from "./tokenizer";

/** A metric name starts with a capital letter, as a name does in the net IR. */
const NAME = /^[A-Z][A-Za-z0-9]*$/u;

export type MetricParseResult = { expr?: MetricExpr; diagnostics: Diagnostic[] };

/**
 * Reads `count(Place)`, `fired(Transition)` or a metric name from the stream.
 * The constraint parser reuses it for the left side of an atom.
 */
export function parseMetricRef(stream: TokenStream): MetricRef {
  const token = peek(stream);
  if (token.kind !== "word") {
    throw new ParseError(
      `Expected a metric, count(Place) or fired(Transition) but found ${describe(token)}`,
      token.column,
    );
  }
  if (token.text === "count" || token.text === "fired") {
    advance(stream);
    expectPunct(stream, "(");
    const target = peek(stream);
    if (target.kind !== "word") {
      throw new ParseError(
        `Expected the name of a ${token.text === "count" ? "place" : "transition"} but found ${describe(target)}`,
        target.column,
      );
    }
    advance(stream);
    expectPunct(stream, ")");
    return token.text === "count"
      ? { kind: "count", place: target.text }
      : { kind: "fired", transition: target.text };
  }
  if (!NAME.test(token.text)) {
    throw new ParseError(
      `Unknown word "${token.text}". A metric name starts with a capital letter`,
      token.column,
    );
  }
  advance(stream);
  return { kind: "metric", name: token.text };
}

function parseExpr(stream: TokenStream): MetricExpr {
  let left = parseTerm(stream);
  for (;;) {
    const token = peek(stream);
    if (!isPunct(token, "+") && !isPunct(token, "-")) {
      return left;
    }
    advance(stream);
    left = { kind: "binary", op: token.text === "+" ? "+" : "-", left, right: parseTerm(stream) };
  }
}

function parseTerm(stream: TokenStream): MetricExpr {
  let left = parseFactor(stream);
  for (;;) {
    const token = peek(stream);
    if (!isPunct(token, "*") && !isPunct(token, "/")) {
      return left;
    }
    advance(stream);
    left = { kind: "binary", op: token.text === "*" ? "*" : "/", left, right: parseFactor(stream) };
  }
}

function parseFactor(stream: TokenStream): MetricExpr {
  const token = peek(stream);
  if (token.kind === "number") {
    advance(stream);
    return { kind: "number", value: token.value };
  }
  if (isPunct(token, "-")) {
    advance(stream);
    return { kind: "negate", operand: parseFactor(stream) };
  }
  if (isPunct(token, "(")) {
    advance(stream);
    const inner = parseExpr(stream);
    expectPunct(stream, ")");
    return inner;
  }
  if (token.kind === "word") {
    return parseMetricRef(stream);
  }
  throw new ParseError(`Expected a number, a metric or "(" but found ${describe(token)}`, token.column);
}

/** Parses one metric expression such as `count(Queue) + fired(Serve)`. */
export function parseMetricExpr(text: string): MetricParseResult {
  try {
    const stream = createStream(text);
    const expr = parseExpr(stream);
    const rest = peek(stream);
    if (rest.kind !== "end") {
      throw new ParseError(`Unexpected ${describe(rest)}`, rest.column);
    }
    return { expr, diagnostics: [] };
  } catch (error) {
    if (error instanceof ParseError) {
      return {
        diagnostics: [{ severity: "error", message: error.message, column: error.column }],
      };
    }
    throw error;
  }
}
