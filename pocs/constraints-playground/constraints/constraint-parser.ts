import { COMPARATORS } from "./ast";
import { constraintOf, withWindow } from "./formula";
import { parseMetricRef } from "./metric-parser";
import { countAtoms } from "./printer";
import {
  ParseError,
  advance,
  createStream,
  describe,
  expectPunct,
  expectWord,
  isPunct,
  isWord,
  peek,
  tokenEnd,
} from "./tokenizer";

import type { Constraint, StateExpr, Window } from "./ast";
import type { Diagnostic } from "./diagnostics";
import type { Token, TokenStream } from "./tokenizer";

export type ConstraintParseResult = { constraint?: Constraint; diagnostics: Diagnostic[] };

/**
 * What a parse may read beyond the base. `mtl` allows time windows on temporal
 * operators. `nested` allows a temporal operator inside another (full LTL).
 */
export type ParseOptions = { mtl?: boolean; nested?: boolean };

/** The flags as the app holds them: both set. */
export type ConstraintFlags = Required<ParseOptions>;

export const WINDOW_NEEDS_MTL_ERROR = "Time windows need MTL. Turn on MTL at the top.";
export const NESTED_NEEDS_LTL_ERROR = "Nested operators need full LTL. Turn on Nested operators at the top.";

export const NO_TEMPORAL_ERROR = "Start with always, eventually or until";
export const MIXED_WARNING =
  "Mixed and/or without brackets: and binds tighter than or. Add brackets to show what you mean";

export const CHAINED_IFF_ERROR = "Bracket a chain of iff";
export const CHAINED_UNTIL_ERROR = "Bracket a chain of until";
export const UNTIL_WARNING = "Bracket the sides of until";
export const FORALL_ERROR = "for all needs coloured tokens, which the playground does not simulate yet";
export const EXISTS_ERROR = "there exists needs coloured tokens, which the playground does not simulate yet";
export const TEMPORAL_SCOPE_WARNING =
  "A temporal operator covers only its own brackets. Bracket the whole formula to cover the rest";

/** Prefix temporal words: the playground's function style and old word style, and the math letters. */
const PREFIX: Readonly<Record<string, { kind: "always" | "eventually"; math: boolean }>> = {
  always: { kind: "always", math: false },
  eventually: { kind: "eventually", math: false },
  G: { kind: "always", math: true },
  F: { kind: "eventually", math: true },
};

/** Function-style binary temporal words. */
const BINARY: Readonly<Record<string, "until" | "weak-until">> = { until: "until", weak_until: "weak-until" };

/** Infix temporal words. `weak` is read with the `until` after it. */
const INFIX: Readonly<Record<string, "until" | "weak-until">> = {
  until: "until",
  weak_until: "weak-until",
  weak: "weak-until",
  U: "until",
  W: "weak-until",
};

const KEYWORDS = new Set([
  "and",
  "or",
  "not",
  "implies",
  "iff",
  "if",
  "then",
  "else",
  "true",
  "false",
  "always",
  "eventually",
  "until",
  "weak",
  "weak_until",
  "forall",
  "exists",
  "_",
]);

/** A temporal operator the parse built, with the column of its word, to find the ones below the top. */
type Temporal = { node: StateExpr; column: number };

type Context = { stream: TokenStream; diagnostics: Diagnostic[]; mtl: boolean; temporals: Temporal[] };

/** A temporal word with an optional `_` suffix (`F_[0,30]`), which requires a window. */
function splitSuffix(text: string): { base: string; suffix: boolean } {
  return text.endsWith("_") && text.length > 1 ? { base: text.slice(0, -1), suffix: true } : { base: text, suffix: false };
}

function isComparator(token: Token): boolean {
  return token.kind === "punct" && (COMPARATORS as readonly string[]).includes(token.text);
}

/** Reads `[from, to]` if it is next, or fails when `required`. Without MTL a window is an error at its column. */
function parseWindow({ stream, mtl }: Context, required: boolean): Window | undefined {
  const open = peek(stream);
  if (!mtl && (required || isPunct(open, "["))) {
    throw new ParseError(WINDOW_NEEDS_MTL_ERROR, open.column);
  }
  if (!isPunct(open, "[")) {
    if (required) {
      throw new ParseError(`Expected a window such as [0, 30] but found ${describe(open)}`, open.column);
    }
    return undefined;
  }
  advance(stream);
  const from = parseNumber(stream);
  expectPunct(stream, ",");
  const to = parseNumber(stream);
  expectPunct(stream, "]");
  if (from < 0) {
    throw new ParseError("A window starts at 0 or later", open.column);
  }
  if (to < from) {
    throw new ParseError("A window ends at or after its start", open.column);
  }
  return { from, to };
}

/** The infix until at the stream, if any: its kind and how many tokens it spans before the window. */
function infixUntilAt(stream: TokenStream): { kind: "until" | "weak-until"; suffix: boolean } | undefined {
  const token = peek(stream);
  if (token.kind !== "word") {
    return undefined;
  }
  const { base, suffix } = splitSuffix(token.text);
  const kind = INFIX[base];
  if (kind === undefined || (base === "weak" && suffix)) {
    return undefined;
  }
  return { kind, suffix };
}

/**
 * formula := state (untilOp window? state)?
 * Infix until binds loosest of all, below iff. A chain of until is an error.
 */
function parseFormula(context: Context): StateExpr {
  const { stream } = context;
  const holdStart = stream.position;
  const hold = parseState(context);
  const infix = infixUntilAt(stream);
  if (infix === undefined) {
    return hold;
  }
  warnSide(context, hold, holdStart, stream.position - 1);
  const opToken = advance(stream);
  if (opToken.text === "weak") {
    expectWord(stream, "until");
  }
  const window = parseWindow(context, infix.suffix);
  const goalStart = stream.position;
  const goal = parseState(context);
  warnSide(context, goal, goalStart, stream.position - 1);
  const next = peek(stream);
  if (infixUntilAt(stream) !== undefined) {
    throw new ParseError(CHAINED_UNTIL_ERROR, next.column);
  }
  return noteTemporal(context, withWindow({ kind: infix.kind, hold, goal }, window), opToken.column);
}

/** Records a temporal operator the parse built, and returns it. */
function noteTemporal(context: Context, node: StateExpr, column: number): StateExpr {
  context.temporals.push({ node, column });
  return node;
}

const BINARY_KINDS = new Set<StateExpr["kind"]>(["and", "or", "implies", "iff", "ite"]);

/** Warns when a side of infix until joins several atoms and is not in one pair of brackets. */
function warnSide(context: Context, side: StateExpr, start: number, end: number): void {
  const { stream } = context;
  if (!BINARY_KINDS.has(side.kind) || countAtoms(side) <= 1) {
    return;
  }
  const startToken = stream.tokens[start];
  if (startToken === undefined) {
    return;
  }
  const wrapped = isPunct(startToken, "(") && closesAt(stream.tokens, start, end);
  if (!wrapped) {
    context.diagnostics.push({ severity: "warning", message: UNTIL_WARNING, column: startToken.column });
  }
}

function parseState(context: Context): StateExpr {
  const { stream } = context;
  if (!isWord(peek(stream), "if")) {
    return parseIff(context);
  }
  advance(stream);
  const cond = parseState(context);
  expectWord(stream, "then");
  const thenBranch = parseState(context);
  if (!isWord(peek(stream), "else")) {
    return { kind: "ite", cond, then: thenBranch };
  }
  advance(stream);
  return { kind: "ite", cond, then: thenBranch, else: parseState(context) };
}

function parseIff(context: Context): StateExpr {
  const { stream } = context;
  const left = parseImplies(context);
  if (!isWord(peek(stream), "iff")) {
    return left;
  }
  advance(stream);
  const right = parseImplies(context);
  const next = peek(stream);
  if (isWord(next, "iff")) {
    throw new ParseError(CHAINED_IFF_ERROR, next.column);
  }
  return { kind: "iff", left, right };
}

function parseImplies(context: Context): StateExpr {
  const { stream } = context;
  const left = parseOr(context);
  if (!isWord(peek(stream), "implies")) {
    return left;
  }
  advance(stream);
  return { kind: "implies", left, right: parseImplies(context) };
}

function parseOr(context: Context): StateExpr {
  const { stream } = context;
  const first = parseAnd(context);
  const terms = [first];
  while (isWord(peek(stream), "or")) {
    advance(stream);
    terms.push(parseAnd(context));
  }
  if (terms.length === 1) {
    return first.expr;
  }
  const mixed = terms.find((term) => term.expr.kind === "and" && term.bare);
  if (mixed) {
    context.diagnostics.push({ severity: "warning", message: MIXED_WARNING, column: mixed.column });
  }
  return { kind: "or", operands: terms.map((term) => term.expr) };
}

type AndTerm = { expr: StateExpr; column: number; bare: boolean };

/** An `and` chain written without brackets is `bare`: the or above it warns. */
function parseAnd(context: Context): AndTerm {
  const { stream } = context;
  const column = peek(stream).column;
  const first = parseUnary(context);
  if (!isWord(peek(stream), "and")) {
    return { expr: first, column, bare: false };
  }
  const operands = [first];
  while (isWord(peek(stream), "and")) {
    advance(stream);
    operands.push(parseUnary(context));
  }
  return { expr: { kind: "and", operands }, column, bare: true };
}

/** Whether the token after the current one is a comparator: `G <= 5` reads G as a metric. */
function nextIsComparator(stream: TokenStream): boolean {
  const next = stream.tokens[stream.position + 1];
  return next !== undefined && isComparator(next);
}

/**
 * unary := "not" unary
 *        | ("G" | "F") window? unary                    -- math: binds like not
 *        | ("always" | "eventually") window? "(" formula ")"   -- function style
 *        | ("always" | "eventually") window? formula     -- old word style: takes the rest
 *        | ("until" | "weak_until") window? "(" formula "," formula ")"
 *        | primary
 */
function parseUnary(context: Context): StateExpr {
  const { stream } = context;
  const token = peek(stream);
  if (isWord(token, "not")) {
    advance(stream);
    return { kind: "not", operand: parseUnary(context) };
  }
  if (isWord(token, "forall")) {
    throw new ParseError(FORALL_ERROR, token.column);
  }
  if (isWord(token, "exists")) {
    throw new ParseError(EXISTS_ERROR, token.column);
  }
  if (token.kind !== "word") {
    return parsePrimary(context);
  }
  const { base, suffix } = splitSuffix(token.text);
  const prefix = PREFIX[base];
  if (prefix !== undefined && !(prefix.math && !suffix && nextIsComparator(stream))) {
    advance(stream);
    const window = parseWindow(context, suffix);
    if (prefix.math) {
      return noteTemporal(context, withWindow({ kind: prefix.kind, body: parseUnary(context) }, window), token.column);
    }
    const open = peek(stream);
    if (!isPunct(open, "(")) {
      return noteTemporal(context, withWindow({ kind: prefix.kind, body: parseFormula(context) }, window), token.column);
    }
    const before = stream.tokens[stream.position - 1];
    advance(stream);
    const body = parseFormula(context);
    expectPunct(stream, ")");
    const spaced = before !== undefined && open.column > tokenEnd(before);
    if (spaced && continuesFormula(peek(stream))) {
      context.diagnostics.push({ severity: "warning", message: TEMPORAL_SCOPE_WARNING, column: token.column });
    }
    return noteTemporal(context, withWindow({ kind: prefix.kind, body }, window), token.column);
  }
  const binary = BINARY[base];
  if (binary !== undefined) {
    advance(stream);
    const window = parseWindow(context, suffix);
    const open = peek(stream);
    if (!isPunct(open, "(")) {
      throw new ParseError(`${base} takes two sides: ${base}(A, B), or A ${base === "until" ? "until" : "weak until"} B`, open.column);
    }
    advance(stream);
    const hold = parseFormula(context);
    expectPunct(stream, ",");
    const goal = parseFormula(context);
    expectPunct(stream, ")");
    return noteTemporal(context, withWindow({ kind: binary, hold, goal }, window), token.column);
  }
  if (base === "weak") {
    throw new ParseError("Write weak until between its two sides, or weak_until(A, B)", token.column);
  }
  return parsePrimary(context);
}

/** A connective that would continue the formula after a bracketed temporal operator. */
function continuesFormula(token: Token): boolean {
  if (token.kind !== "word") {
    return false;
  }
  return ["and", "or", "implies", "iff"].includes(token.text) || INFIX[splitSuffix(token.text).base] !== undefined;
}

function parsePrimary(context: Context): StateExpr {
  const { stream } = context;
  const token = peek(stream);
  if (isPunct(token, "(")) {
    advance(stream);
    const inner = parseFormula(context);
    expectPunct(stream, ")");
    return inner;
  }
  if (isWord(token, "true") || isWord(token, "false")) {
    advance(stream);
    return { kind: "bool", value: token.text === "true" };
  }
  if (isWord(token, "_")) {
    advance(stream);
    return { kind: "hole" };
  }
  if (isWord(token, "if")) {
    throw new ParseError("Put if ... then ... else in brackets inside another expression", token.column);
  }
  if (token.kind === "word" && !KEYWORDS.has(token.text)) {
    return parseAtom(context);
  }
  throw new ParseError(`Expected a condition but found ${describe(token)}`, token.column);
}

function parseAtom(context: Context): StateExpr {
  const { stream } = context;
  const ref = parseMetricRef(stream);
  const opToken = peek(stream);
  if (opToken.kind === "punct" && ["+", "-", "*", "/"].includes(opToken.text)) {
    throw new ParseError(
      "Arithmetic is not allowed in a constraint. Define a metric for it",
      opToken.column,
    );
  }
  const op = COMPARATORS.find(
    (candidate) => opToken.kind === "punct" && candidate === opToken.text,
  );
  if (op === undefined) {
    throw new ParseError(
      `Expected a comparator (${COMPARATORS.join(", ")}) but found ${describe(opToken)}`,
      opToken.column,
    );
  }
  advance(stream);
  return { kind: "atom", ref, op, value: parseNumber(stream) };
}

function parseNumber(stream: TokenStream): number {
  const negative = isPunct(peek(stream), "-");
  if (negative) {
    advance(stream);
  }
  const token = peek(stream);
  if (token.kind !== "number") {
    throw new ParseError(`Expected a number but found ${describe(token)}`, token.column);
  }
  advance(stream);
  return negative ? -token.value : token.value;
}

/** Whether the bracket opened at `open` is the one closed at `close`. */
function closesAt(tokens: Token[], open: number, close: number): boolean {
  let depth = 0;
  for (let index = open; index <= close; index += 1) {
    const token = tokens[index];
    if (token !== undefined && isPunct(token, "(")) {
      depth += 1;
    } else if (token !== undefined && isPunct(token, ")")) {
      depth -= 1;
      if (depth === 0) {
        return index === close;
      }
    }
  }
  return false;
}

/**
 * Parses one constraint. The canonical form is word style, such as
 * `always (Waiting <= 5)`; function style and the math notation are read
 * too (SPEC.md, "Constraint grammar"). A formula with no temporal operator at
 * the top is a `now` constraint. Time windows are MTL: they parse only with
 * `options.mtl`. A temporal operator that is not the top one is full LTL:
 * it parses only with `options.nested`.
 */
export function parseConstraint(text: string, options: ParseOptions = {}): ConstraintParseResult {
  const diagnostics: Diagnostic[] = [];
  try {
    const stream = createStream(text);
    const first = peek(stream);
    if (first.kind === "end") {
      throw new ParseError(NO_TEMPORAL_ERROR, first.column);
    }
    const temporals: Temporal[] = [];
    const formula = parseFormula({ stream, diagnostics, mtl: options.mtl ?? false, temporals });
    const rest = peek(stream);
    if (rest.kind !== "end") {
      throw new ParseError(`Unexpected ${describe(rest)}`, rest.column);
    }
    const below = temporals.filter((temporal) => temporal.node !== formula);
    if (!(options.nested ?? false) && below.length > 0) {
      throw new ParseError(NESTED_NEEDS_LTL_ERROR, Math.min(...below.map((temporal) => temporal.column)));
    }
    return { constraint: constraintOf(formula), diagnostics };
  } catch (error) {
    if (error instanceof ParseError) {
      diagnostics.push({ severity: "error", message: error.message, column: error.column });
      return { diagnostics };
    }
    throw error;
  }
}
