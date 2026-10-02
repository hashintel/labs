import type { LineRange } from "../../compiler";

/**
 * Lines quoted from one text, with their numbers: what a live sample or a
 * question's evidence shows of a file. `CodeExcerpt` renders one.
 */

export type ExcerptLine = {
  /** 1-based, in the source text. */
  number: number;
  text: string;
  /** A line the excerpt points at, lit as the editors light it. */
  lit: boolean;
};

/** Lines quoted from one text, in order; the numbers may skip. */
export type Excerpt = {
  /** The text the lines come from: `net.py`, `IR`. */
  source: string;
  lines: ExcerptLine[];
};

/** `count` lines of the text from `firstLine`, lighting the ones listed. */
export function excerptOf(
  source: string,
  text: string,
  firstLine: number,
  count: number,
  lit: readonly number[] = [],
): Excerpt {
  const lines = text
    .split("\n")
    .slice(firstLine - 1, firstLine - 1 + count)
    .map((line, index) => ({ number: firstLine + index, text: line, lit: lit.includes(firstLine + index) }));
  return { source, lines };
}

/** The listed lines of the text alone, lit unless told otherwise. */
export function excerptOfLines(
  source: string,
  text: string,
  numbers: readonly number[],
  lit = true,
): Excerpt {
  const lines = text.split("\n");
  return {
    source,
    lines: numbers.map((number) => ({ number, text: lines[number - 1] ?? "", lit })),
  };
}

/** The lines the ranges cover, each once, in order. */
export function coveredLines(ranges: readonly LineRange[]): number[] {
  const lines = ranges.flatMap(({ startLine, endLine }) =>
    Array.from({ length: endLine - startLine + 1 }, (_, index) => startLine + index),
  );
  return [...new Set(lines)].toSorted((a, b) => a - b);
}
