import {
  excerptOf as excerptOfText,
  excerptOfLines as excerptOfNumbers,
} from "../../ui/excerpt";

import type { LineRange } from "../../../compiler";
import type { Excerpt } from "../../ui/excerpt";

export { coveredLines } from "../../ui/excerpt";

/** The most lines a sample quotes. */
export const EXCERPT_LINES = 8;

/** `count` lines of the text from `firstLine`, at most `EXCERPT_LINES`, lighting the ones listed. */
export function excerptOf(
  source: string,
  text: string,
  firstLine: number,
  count = EXCERPT_LINES,
  lit: readonly number[] = [],
): Excerpt {
  return excerptOfText(source, text, firstLine, Math.min(count, EXCERPT_LINES), lit);
}

/** The listed lines of the text alone, each lit, up to `EXCERPT_LINES`. */
export function excerptOfLines(source: string, text: string, numbers: readonly number[]): Excerpt {
  return excerptOfNumbers(source, text, numbers.slice(0, EXCERPT_LINES));
}

export function lineSpan({ startLine, endLine }: LineRange): string {
  return startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`;
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
