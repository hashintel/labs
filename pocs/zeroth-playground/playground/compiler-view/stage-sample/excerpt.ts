import type { SampleExcerpt } from "../stage-sample";

type LineRange = { startLine: number; endLine: number };

/** The most lines a sample quotes. */
export const EXCERPT_LINES = 8;

/** `count` lines of the text from `firstLine`, at most `EXCERPT_LINES`, lighting the ones listed. */
export function excerptOf(
  source: string,
  text: string,
  firstLine: number,
  count = EXCERPT_LINES,
  lit: readonly number[] = [],
): SampleExcerpt {
  const lines = text
    .split("\n")
    .slice(firstLine - 1, firstLine - 1 + Math.min(count, EXCERPT_LINES))
    .map((line, index) => ({ number: firstLine + index, text: line, lit: lit.includes(firstLine + index) }));
  return { source, lines };
}

/** The listed lines of the text alone, each lit, up to `EXCERPT_LINES`. */
export function excerptOfLines(source: string, text: string, numbers: readonly number[]): SampleExcerpt {
  const lines = text.split("\n");
  return {
    source,
    lines: numbers.slice(0, EXCERPT_LINES).map((number) => ({ number, text: lines[number - 1] ?? "", lit: true })),
  };
}

export function lineSpan({ startLine, endLine }: LineRange): string {
  return startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`;
}

/** The lines the ranges cover, each once, in order. */
export function coveredLines(ranges: readonly LineRange[]): number[] {
  const lines = ranges.flatMap(({ startLine, endLine }) =>
    Array.from({ length: endLine - startLine + 1 }, (_, index) => startLine + index),
  );
  return [...new Set(lines)].toSorted((a, b) => a - b);
}

/** Line numbers in order, written as runs: `line 18`, `lines 11, 15, 23–34`. */
export function linesLabel(numbers: readonly number[]): string {
  const runs: { start: number; end: number }[] = [];
  for (const number of numbers) {
    const last = runs.at(-1);
    if (last !== undefined && number === last.end + 1) {
      last.end = number;
    } else {
      runs.push({ start: number, end: number });
    }
  }
  const written = runs.map(({ start, end }) => (start === end ? `${start}` : `${start}–${end}`)).join(", ");
  return `${numbers.length === 1 ? "line" : "lines"} ${written}`;
}
