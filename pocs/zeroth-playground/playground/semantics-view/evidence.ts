import { compile, itemLabel, linesOfItem } from "../../compiler";
import { coveredLines, excerptOf, excerptOfLines } from "../ui/excerpt";

import type { Example } from "../../examples/catalog";
import type { Showing } from "../../semantics/register";
import type { Excerpt } from "../ui/excerpt";

/**
 * What a question's showing quotes: the example compiled at the showing's
 * options, and the lines of its first file that the net item owns; the first
 * lines of the file without an item. A compile that refuses quotes its first
 * diagnostic instead. Pure, and independent of the document the Examples
 * view has open.
 */
export type Evidence = { kind: "lines"; excerpt: Excerpt } | { kind: "refused"; message: string };

/** The most lines a showing quotes. */
export const EVIDENCE_LINES = 14;

/** The lines quoted when the showing names no item. */
const OPENING_LINES = 12;

export function evidenceOf(example: Example, showing: Showing): Evidence {
  const compilation = compile(example.ir, { options: showing.options });
  const file = compilation.files[0];
  if (file === undefined) {
    const error = compilation.errors[0];
    return {
      kind: "refused",
      message: error === undefined ? "Refused without a diagnostic." : `${error.code}: ${error.message}`,
    };
  }
  const { item } = showing;
  if (item === undefined) {
    return { kind: "lines", excerpt: excerptOf(`${file.path} · first ${OPENING_LINES} lines`, file.text, 1, OPENING_LINES) };
  }
  const lines = coveredLines(linesOfItem(file.trace, item));
  const shown = lines.slice(0, EVIDENCE_LINES);
  const cut = lines.length > shown.length ? ` · first ${shown.length} of ${lines.length} lines` : "";
  return {
    kind: "lines",
    excerpt: excerptOfLines(`${file.path} · ${itemLabel(item)}${cut}`, file.text, shown, false),
  };
}
