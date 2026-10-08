import type { TemporalOp } from "../../constraints/ast";

/** One state of a mini timeline: its mark, what it shows, and whether it decides the verdict. */
export type HintCell = { mark: "✓" | "✗" | ""; tone: "holds" | "broken" | "idle"; decisive: boolean };

/** One row of a mini timeline; a row with a `tag` is one of two parts, such as A and B. */
export type HintRow = { tag?: string; cells: HintCell[] };

/** What a hover on a keyword shows: its plain meaning, and for an operator its title and a six-step timeline. */
export type Hint = { title?: string; line: string; rows?: HintRow[] };

/** The steps a mini timeline draws. */
export const HINT_STEPS = 6;

/** A row from a pattern of six marks: ✓ holds, ✗ does not, · not read; `decisive` is the index of the cell that decides. */
function row(pattern: string, decisive?: number, tag?: string): HintRow {
  const marks = [...pattern];
  return {
    ...(tag === undefined ? {} : { tag }),
    cells: marks.map((mark, at) => ({
      mark: mark === "·" ? "" : (mark as "✓" | "✗"),
      tone: mark === "✓" ? "holds" : mark === "✗" ? "broken" : "idle",
      decisive: at === decisive,
    })),
  };
}

/** The hover of each temporal operator's chip. */
export const OPERATOR_HINTS: Readonly<Record<TemporalOp, Hint>> = {
  always: {
    title: "ALWAYS",
    line: "Holds at every step. Violated at the first step it fails.",
    rows: [row("✓✓✓✗··", 3)],
  },
  eventually: {
    title: "EVENTUALLY",
    line: "Holds at some step. Satisfied the first time it holds.",
    rows: [row("✗✗✓···", 2)],
  },
  until: {
    title: "UNTIL",
    line: "A holds at every step until B holds, and B must come.",
    rows: [row("✓✓✓···", undefined, "A"), row("✗✗✗✓··", 3, "B")],
  },
  "weak-until": {
    title: "WEAK UNTIL",
    line: "Like UNTIL, but B may never come if A holds to the end.",
    rows: [row("✓✓✓✓✓✓", 5, "A"), row("✗✗✗✗✗✗", undefined, "B")],
  },
};

/** The hover of each keyword between parts of a block. */
export const WORD_HINTS: Readonly<Record<string, Hint>> = {
  IF: { line: "when the IF part holds, the THEN part must hold" },
  THEN: { line: "when the IF part holds, the THEN part must hold" },
  ELSE: { line: "when the IF part does not hold, the ELSE part must hold" },
  IFF: { line: "if and only if: both sides true, or both false" },
  NOT: { line: "the opposite" },
};
