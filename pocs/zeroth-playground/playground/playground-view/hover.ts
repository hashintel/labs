import { itemLabel, matchingLines, provenanceAt } from "../../compiler";

import type { NetItem, Provenance, Trace } from "../../compiler";
import type { LineDecoration } from "../editor/line-decorations";

/**
 * What the pointer is on, shared by the IR, the module and the preview: the
 * provenance under it and the view it started in. The other two light the
 * lines or the item that belong with it.
 */
export type Hover = {
  origin: "ir" | "module" | "preview";
  provenance: Provenance;
};

/** The hover a line in a view stands for, or `null` off every traced range. */
export function hoverAtLine(
  origin: Hover["origin"],
  trace: Trace,
  line: number | null,
): Hover | null {
  const provenance = line === null ? null : provenanceAt(trace, line);
  return provenance === null ? null : { origin, provenance };
}

/** The lines a view lights: those in its trace that match a hover begun in another view. */
export function litLines(
  view: Hover["origin"],
  trace: Trace,
  hover: Hover | null,
): LineDecoration[] {
  return hover === null || hover.origin === view
    ? []
    : matchingLines(trace, hover.provenance).map((range) => ({ ...range, kind: "lit" }));
}

/** The hover a node of the preview stands for. */
export function hoverAtSource(source: NetItem | null): Hover | null {
  return source === null ? null : { origin: "preview", provenance: { what: itemLabel(source), source } };
}
