import { sameItem } from "../ir/net-item";

import type { NetItem } from "../ir/net-item";

/**
 * A line trace over the IR text and the generated Python: which lines
 * belong to what, why the compiler wrote them, and the net item they come
 * from. A reader shows a range's record on hover and lights its item
 * wherever else it is drawn. Ranges nest, section over entry over field, so a line's
 * record is the innermost range holding it.
 */

export type Provenance = {
  /** What the lines are, as a short noun phrase. */
  what: string;
  /** Why they are there, when the lines do not say it themselves. */
  why?: string;
  /** The IR path the lines render or compile from, `transitions.Serve.rate`. */
  ir?: string;
  source?: NetItem;
};

/** 1-based, inclusive. */
export type LineRange = {
  startLine: number;
  endLine: number;
};

export type TraceRange = LineRange & {
  provenance: Provenance;
};

export type Trace = TraceRange[];

/** The innermost range holding the line, or `null` off every range. */
export function provenanceAt(trace: Trace, line: number): Provenance | null {
  let best: TraceRange | null = null;
  for (const range of trace) {
    if (line < range.startLine || line > range.endLine) {
      continue;
    }
    if (best === null || range.endLine - range.startLine < best.endLine - best.startLine) {
      best = range;
    }
  }
  return best?.provenance ?? null;
}

// -- Matching ----------------------------------------------------------------

/**
 * When two traced ranges belong together: their provenance names the same
 * net item, or, for lines without one, their IR paths share a prefix. The
 * rule behind cross-highlighting: a hover on one side lights the ranges on
 * the other side that match.
 */

function sharesIrPrefix(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

function matches(a: Provenance, b: Provenance): boolean {
  if (a.source !== undefined && b.source !== undefined) {
    return sameItem(a.source, b.source);
  }
  if (a.source === undefined && b.source === undefined) {
    return a.ir !== undefined && b.ir !== undefined && sharesIrPrefix(a.ir, b.ir);
  }
  return false;
}

function lineRange({ startLine, endLine }: TraceRange): LineRange {
  return { startLine, endLine };
}

/** The ranges in the trace that belong with the provenance. */
export function matchingLines(trace: Trace, provenance: Provenance): LineRange[] {
  return trace.filter((range) => matches(range.provenance, provenance)).map(lineRange);
}

/** The ranges of one net item, for a hover that starts on the net itself. */
export function linesOfItem(trace: Trace, item: NetItem): LineRange[] {
  return trace
    .filter(
      ({ provenance }) => provenance.source !== undefined && sameItem(provenance.source, item),
    )
    .map(lineRange);
}

/** The first line of the item's first range, or `undefined` when no range is its own. */
export function firstLineOf(trace: Trace, item: NetItem): number | undefined {
  return linesOfItem(trace, item)[0]?.startLine;
}
