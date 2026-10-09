import { stageById } from "./stages";

import type { StageId, StageKind } from "./stages";

/**
 * Where the stages sit in the pipeline graph and how they connect, in the
 * SVG's own units. Three bands: the side inputs over the lowering, the
 * compile from text to Python, and under it the read-back from the traces
 * to the hover, with the diagnostics at its start. A focus on one stage
 * lights it and its edges, keeps its neighbours and dims the rest.
 */

export const PIPELINE_VIEWBOX = { x: 0, y: 18, width: 1040, height: 300 };

const SIZES: Record<StageKind, { width: number; height: number }> = {
  data: { width: 120, height: 46 },
  step: { width: 110, height: 36 },
  input: { width: 112, height: 40 },
};

const CENTRES: Record<StageId, { x: number; y: number }> = {
  "code-parser": { x: 520, y: 50 },
  options: { x: 745, y: 50 },
  "ir-text": { x: 70, y: 150 },
  parse: { x: 220, y: 150 },
  ir: { x: 370, y: 150 },
  lower: { x: 520, y: 150 },
  graph: { x: 670, y: 150 },
  emit: { x: 820, y: 150 },
  files: { x: 970, y: 150 },
  diagnostics: { x: 220, y: 275 },
  trace: { x: 370, y: 275 },
  traces: { x: 600, y: 275 },
  provenance: { x: 785, y: 275 },
  hover: { x: 970, y: 275 },
};

export type NodeBox = {
  /** The centre. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LabelSide = "above" | "below";

export type PipelineEdge = {
  from: StageId;
  to: StageId;
  /** A few words on what passes along it. */
  label?: string;
  /** Where along the edge the label sits, from 0 at the start to 1 at the end; the middle by default. */
  labelAt?: number;
  /** Which side of the line the label stands on: above (right of a vertical line) by default. */
  labelSide?: LabelSide;
  /** For an input that is not there. */
  absent?: boolean;
};

export const PIPELINE_EDGES: readonly PipelineEdge[] = [
  { from: "ir-text", to: "parse" },
  { from: "parse", to: "ir" },
  { from: "ir", to: "lower" },
  { from: "code-parser", to: "lower", absent: true },
  { from: "options", to: "lower" },
  { from: "options", to: "emit", label: "files" },
  { from: "lower", to: "graph" },
  { from: "graph", to: "emit" },
  { from: "emit", to: "files" },
  { from: "ir", to: "trace" },
  { from: "trace", to: "traces" },
  { from: "files", to: "traces", label: "trace" },
  { from: "traces", to: "provenance" },
  { from: "provenance", to: "hover" },
  { from: "parse", to: "diagnostics", label: "errors" },
  { from: "lower", to: "diagnostics", label: "errors", labelAt: 0.3, labelSide: "below" },
  { from: "trace", to: "diagnostics", label: "line" },
];

export function nodeBox(id: StageId): NodeBox {
  return { ...CENTRES[id], ...SIZES[stageById(id).kind] };
}

/** Where the line from the box's centre toward `toward` leaves the box, `gap` units further out. */
function boundaryPoint(box: NodeBox, toward: { x: number; y: number }, gap: number) {
  const dx = toward.x - box.x;
  const dy = toward.y - box.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return { x: box.x, y: box.y };
  }
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : box.width / 2 / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : box.height / 2 / Math.abs(dy),
  );
  return {
    x: box.x + dx * scale + (dx / length) * gap,
    y: box.y + dy * scale + (dy / length) * gap,
  };
}

export type EdgeLine = { x1: number; y1: number; x2: number; y2: number };

/** The straight line of an edge, from the edge of one box to the edge of the other, rounded to 0.1. */
export function edgeLine(from: NodeBox, to: NodeBox): EdgeLine {
  const start = boundaryPoint(from, to, 1);
  const end = boundaryPoint(to, from, 3);
  const round = (value: number) => Math.round(value * 10) / 10;
  return { x1: round(start.x), y1: round(start.y), x2: round(end.x), y2: round(end.y) };
}

/** How far a label stands off its line. */
const LABEL_OFFSET = 6;

/**
 * Where an edge's label sits: `at` along the line, stood off it along its
 * normal on the upper side (right of a vertical line) or the other, anchored
 * away from the line.
 */
export function edgeLabel(
  line: EdgeLine,
  at = 0.5,
  side: LabelSide = "above",
): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length = Math.hypot(dx, dy) || 1;
  const upper = dx > 0 || (dx === 0 && dy > 0) ? 1 : -1;
  const flip = side === "above" ? upper : -upper;
  const normal = { x: (flip * dy) / length, y: (-flip * dx) / length };
  const anchor = normal.x > 0.3 ? "start" : normal.x < -0.3 ? "end" : "middle";
  return {
    x: Math.round((line.x1 + dx * at + normal.x * LABEL_OFFSET) * 10) / 10,
    // A side label drops by a third of its height so its middle meets the line's.
    y: Math.round((line.y1 + dy * at + normal.y * LABEL_OFFSET + (anchor === "middle" && normal.y < 0 ? 0 : 3)) * 10) / 10,
    anchor,
  };
}

/**
 * How a node shows under a focus: `focus` for the focused stage, `near` for
 * the stages an edge joins it to, `dim` for the rest, `rest` with no focus.
 */
export type FocusState = "rest" | "focus" | "near" | "dim";

function edgeTouches(edge: PipelineEdge, stage: StageId): boolean {
  return edge.from === stage || edge.to === stage;
}

export function nodeFocus(id: StageId, focused: StageId | null): FocusState {
  if (focused === null) {
    return "rest";
  }
  if (id === focused) {
    return "focus";
  }
  const near = PIPELINE_EDGES.some(
    (edge) => edgeTouches(edge, focused) && edgeTouches(edge, id),
  );
  return near ? "near" : "dim";
}

export function edgeFocus(edge: PipelineEdge, focused: StageId | null): FocusState {
  if (focused === null) {
    return "rest";
  }
  return edgeTouches(edge, focused) ? "focus" : "dim";
}
