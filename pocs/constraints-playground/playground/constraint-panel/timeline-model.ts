import type { Verdict, Window } from "../../constraints/ast";

/** What one state of the run is, for the hover line. */
export type StepInfo = {
  step: number;
  time: number;
  /** The transition that fired into this state; `null` at the initial state. */
  fired: string | null;
};

/**
 * One row of the timeline, labelled in the builder's words. A metric row
 * carries the values the rule compares the metric with, which the strip draws
 * as dashed lines. `link` names the conditions a row stands for, by their
 * canonical text, so a hover on the row and on a condition can find each other.
 */
export type TimelineRow =
  | { kind: "atom"; label: string; values: boolean[]; link?: string[] }
  | { kind: "metric"; label: string; values: (number | null)[]; thresholds: number[]; link?: string[] }
  | { kind: "verdict"; label: string; values: Verdict[] };

/** The run as the timeline draws it: one column per state, one row per atom, metric and the verdict. */
export type Timeline = {
  steps: StepInfo[];
  rows: TimelineRow[];
  /** The top operator's time window, counted from the first state. Nested windows are not drawn. */
  window?: Window;
};

/**
 * The first and last column of the states inside the window, or `null` when
 * there is no window or no state touches it. A state holds from its time to
 * the next one's, so one that began before the window and is still active when
 * it opens counts. The last state counts only if it begins inside the window.
 */
export function windowColumns(timeline: Timeline): { first: number; last: number } | null {
  const { window, steps } = timeline;
  const origin = steps[0]?.time;
  if (window === undefined || origin === undefined) {
    return null;
  }
  const lo = origin + window.from;
  const hi = origin + window.to;
  const inside = steps.flatMap((info, index) => {
    const next = steps[index + 1]?.time;
    const touches = info.time <= hi && (info.time >= lo || (next !== undefined && next > lo));
    return touches ? [index] : [];
  });
  const first = inside[0];
  const last = inside.at(-1);
  return first === undefined || last === undefined ? null : { first, last };
}

/** Rounds a number for display: whole numbers as they are, others to 3 decimals. */
export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/** Rounds a run time for display to one decimal, as the example pages write it. */
export function formatTime(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** How a row's value reads: a number as is, a condition as holds or does not, the verdict as the colour key says. */
export function describeValue(row: TimelineRow, index: number): string {
  const value = row.values[index];
  switch (row.kind) {
    case "metric":
      return typeof value === "number" ? formatNumber(value) : "no value";
    case "atom":
      return value === true ? "holds" : "does not hold";
    case "verdict":
      return value === "satisfied" ? "holds" : value === "violated" ? "broken" : "not decided yet";
  }
}

/** The hover line for one state: its step, time, firing, and each row's value there, in the row labels' words. */
export function describeStep(timeline: Timeline, index: number): string {
  const info = timeline.steps[index];
  if (info === undefined) {
    return "";
  }
  const head = [`step ${info.step}`, `time ${formatTime(info.time)}`, info.fired === null ? "start" : `${info.fired} fired`];
  const values = timeline.rows.map((row) => `${row.label}: ${describeValue(row, index)}`);
  return [...head, ...values].join(" · ");
}

/** The value range a metric strip spans: its values and thresholds, a lone value alone. `null` without any value. */
export function metricRange(row: Extract<TimelineRow, { kind: "metric" }>): { low: number; high: number } | null {
  const known = [...row.values.filter((value): value is number => value !== null), ...row.thresholds];
  return known.length === 0 ? null : { low: Math.min(...known), high: Math.max(...known) };
}

/** The share of a metric's span left empty above its largest value, so the line does not touch the top of its strip. */
export const METRIC_HEADROOM = 0.1;

/** A metric strip's y-scale: its range with the headroom added above. A flat range has none. */
export function metricPlotRange(row: Extract<TimelineRow, { kind: "metric" }>): { low: number; high: number } | null {
  const range = metricRange(row);
  return range === null ? null : { low: range.low, high: range.high + (range.high - range.low) * METRIC_HEADROOM };
}

/**
 * The axis under the strips: the first and last step, and their times when
 * time advances over the run, which a run of an untimed net does not.
 */
export function axisOf(timeline: Timeline): { first: string; last: string; times: { first: string; last: string } | null } | null {
  const first = timeline.steps[0];
  const last = timeline.steps.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }
  return {
    first: `step ${first.step}`,
    last: `step ${last.step}`,
    times:
      last.time > first.time
        ? { first: `time ${formatTime(first.time)}`, last: `time ${formatTime(last.time)}` }
        : null,
  };
}

/** The state index under a pointer at `x` over a strip `width` wide holding `count` columns, or `null` off the strip. */
export function columnAt(x: number, width: number, count: number): number | null {
  if (count === 0 || width <= 0 || x < 0 || x >= width) {
    return null;
  }
  return Math.floor((x / width) * count);
}
