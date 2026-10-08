import type { Constraint, StateExpr } from "./ast";
import type { RunState } from "./simulate";

/** Where a node sits, as keys from the constraint down: `["body", "operands", 1]`. */
export type ScopePath = readonly (string | number)[];

/** One part of a constraint that goes beyond the base, or is not filled in yet. */
export type ScopeNote = {
  kind: "nested" | "window" | "now" | "hole";
  message: string;
  /** The node the note is about. Absent for a note about the whole constraint. */
  path?: ScopePath;
};

export const NOW_NOTE = "Beyond the base: no operator, first step only";
export const NESTED_NOTE = "Beyond the base: an operator inside another";
export const NESTED_IN_CONDITION_NOTE = "Beyond the base: an operator inside a condition";
export const WINDOW_NOTE = "Beyond the base: a time window (MTL)";
export const HOLE_NOTE = "Empty slot: fill it to get a verdict";
export const FROZEN_TIME_NOTE =
  "This run never advances time: a window from 0 covers the rest of the run, and a later window never starts";

/**
 * What a constraint uses beyond the base (a temporal operator below the top, a
 * window, no operator at the top) and its unfilled slots, in reading order.
 * With the run's states, a window on a run whose time never moves gets one
 * more note.
 */
export function scopeNotes(constraint: Constraint, states?: readonly RunState[]): ScopeNote[] {
  const notes: ScopeNote[] = [];
  let windowed = false;
  if (constraint.op === "now") {
    notes.push({ kind: "now", message: NOW_NOTE });
  } else if (constraint.window !== undefined) {
    windowed = true;
    notes.push({ kind: "window", message: WINDOW_NOTE, path: [] });
  }

  function visit(expr: StateExpr, path: ScopePath, insideTemporal: boolean): void {
    switch (expr.kind) {
      case "hole":
        notes.push({ kind: "hole", message: HOLE_NOTE, path });
        return;
      case "atom":
      case "bool":
        return;
      case "always":
      case "eventually":
      case "until":
      case "weak-until":
        notes.push({ kind: "nested", message: insideTemporal ? NESTED_NOTE : NESTED_IN_CONDITION_NOTE, path });
        if (expr.window !== undefined) {
          windowed = true;
          notes.push({ kind: "window", message: WINDOW_NOTE, path });
        }
        if ("body" in expr) {
          visit(expr.body, [...path, "body"], true);
        } else {
          visit(expr.hold, [...path, "hold"], true);
          visit(expr.goal, [...path, "goal"], true);
        }
        return;
      case "not":
        visit(expr.operand, [...path, "operand"], insideTemporal);
        return;
      case "and":
      case "or":
        expr.operands.forEach((operand, index) => visit(operand, [...path, "operands", index], insideTemporal));
        return;
      case "implies":
      case "iff":
        visit(expr.left, [...path, "left"], insideTemporal);
        visit(expr.right, [...path, "right"], insideTemporal);
        return;
      case "ite":
        visit(expr.cond, [...path, "cond"], insideTemporal);
        visit(expr.then, [...path, "then"], insideTemporal);
        if (expr.else !== undefined) {
          visit(expr.else, [...path, "else"], insideTemporal);
        }
        return;
    }
  }

  if ("body" in constraint) {
    visit(constraint.body, ["body"], constraint.op !== "now");
  } else {
    visit(constraint.hold, ["hold"], true);
    visit(constraint.goal, ["goal"], true);
  }

  const first = states?.[0];
  const last = states?.at(-1);
  if (windowed && first !== undefined && last !== undefined && last.time === first.time) {
    notes.push({ kind: "window", message: FROZEN_TIME_NOTE });
  }
  return notes;
}

/** Whether a constraint is inside the base: one temporal operator at the top, no window, no hole. */
export function isV1(constraint: Constraint): boolean {
  return scopeNotes(constraint).length === 0;
}
