/**
 * One tokenizer for both grammars. Aliases are folded here, so the parsers
 * see one spelling: `->` `→` read as the word `implies`, `<->` `↔` as `iff`,
 * `&&` `∧` as `and`, `||` `∨` as `or`, `!` `¬` as `not`, `□` as the hole `_`,
 * `∀` as `forall`, `∃` as `exists`, the symbols `≤ ≥ ≠` as their ASCII
 * comparators, and a single `=` as `==`.
 */

export type Token = {
  kind: "number" | "word" | "punct" | "end";
  text: string;
  /** Column of the token's first character, counted from 1. */
  column: number;
  /** The number's value, for a number token. */
  value: number;
  /** Length of the token in the source text. */
  length: number;
};

/** A parse failure at one column. The parsers catch it and report one diagnostic. */
export class ParseError extends Error {
  readonly column: number;

  constructor(message: string, column: number) {
    super(message);
    this.column = column;
  }
}

const PUNCTUATION = [
  "<->",
  "->",
  "<=",
  ">=",
  "==",
  "!=",
  "&&",
  "||",
  "<",
  ">",
  "=",
  "!",
  "+",
  "-",
  "*",
  "/",
  "(",
  ")",
  "[",
  "]",
  ",",
  "≤",
  "≥",
  "≠",
  "∧",
  "∨",
  "¬",
  "→",
  "↔",
  "□",
  "∀",
  "∃",
];

const SYMBOL_ALIASES: Readonly<Record<string, string>> = { "≤": "<=", "≥": ">=", "≠": "!=", "=": "==" };
const WORD_ALIASES: Readonly<Record<string, string>> = {
  "->": "implies",
  "→": "implies",
  "<->": "iff",
  "↔": "iff",
  "&&": "and",
  "∧": "and",
  "||": "or",
  "∨": "or",
  "!": "not",
  "¬": "not",
  "□": "_",
  "∀": "forall",
  "∃": "exists",
};

const NUMBER = /^(?:\d+(?:\.\d+)?)(?:[eE][+-]?\d+)?/u;
const WORD = /^[A-Za-z_][A-Za-z0-9_]*/u;

/** The column just after a token, in the source text. Aliased tokens keep their source length. */
export function tokenEnd(token: Token): number {
  return token.column + token.length;
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    const column = index + 1;
    if (/^\s/u.test(rest)) {
      index += 1;
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number) {
      tokens.push({ kind: "number", text: number[0], column, value: Number(number[0]), length: number[0].length });
      index += number[0].length;
      continue;
    }
    const word = WORD.exec(rest);
    if (word) {
      tokens.push({ kind: "word", text: word[0], column, value: 0, length: word[0].length });
      index += word[0].length;
      continue;
    }
    const punct = PUNCTUATION.find((candidate) => rest.startsWith(candidate));
    if (punct !== undefined) {
      const wordAlias = WORD_ALIASES[punct];
      if (wordAlias === undefined) {
        tokens.push({ kind: "punct", text: SYMBOL_ALIASES[punct] ?? punct, column, value: 0, length: punct.length });
      } else {
        tokens.push({ kind: "word", text: wordAlias, column, value: 0, length: punct.length });
      }
      index += punct.length;
      continue;
    }
    throw new ParseError(`Unexpected character "${rest[0]}"`, column);
  }
  tokens.push({ kind: "end", text: "", column: text.length + 1, value: 0, length: 0 });
  return tokens;
}

export type TokenStream = { tokens: Token[]; position: number };

export function createStream(text: string): TokenStream {
  return { tokens: tokenize(text), position: 0 };
}

export function peek(stream: TokenStream): Token {
  const token = stream.tokens[Math.min(stream.position, stream.tokens.length - 1)];
  if (token === undefined) {
    throw new Error("a token stream always ends with an end token");
  }
  return token;
}

export function advance(stream: TokenStream): Token {
  const token = peek(stream);
  if (token.kind !== "end") {
    stream.position += 1;
  }
  return token;
}

export function isWord(token: Token, text: string): boolean {
  return token.kind === "word" && token.text === text;
}

export function isPunct(token: Token, text: string): boolean {
  return token.kind === "punct" && token.text === text;
}

/** How a token reads in an error message. */
export function describe(token: Token): string {
  return token.kind === "end" ? "the end of the text" : `"${token.text}"`;
}

/** Consumes a punctuation token or fails. */
export function expectPunct(stream: TokenStream, text: string): Token {
  const token = peek(stream);
  if (!isPunct(token, text)) {
    throw new ParseError(`Expected "${text}" but found ${describe(token)}`, token.column);
  }
  return advance(stream);
}

/** Consumes a given word or fails. */
export function expectWord(stream: TokenStream, text: string): Token {
  const token = peek(stream);
  if (!isWord(token, text)) {
    throw new ParseError(`Expected "${text}" but found ${describe(token)}`, token.column);
  }
  return advance(stream);
}
