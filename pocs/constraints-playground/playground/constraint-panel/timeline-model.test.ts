import { describe, expect, it } from "vitest";

import { type Timeline, axisOf, columnAt, describeStep, metricPlotRange, metricRange, windowColumns } from "./timeline-model";

const timeline: Timeline = {
  steps: [
    { step: 0, time: 0, fired: null },
    { step: 1, time: 0.5, fired: "Arrive" },
  ],
  rows: [
    { kind: "metric", label: "Waiting", values: [0, 6], thresholds: [5] },
    { kind: "atom", label: "Waiting <= 5", values: [true, false] },
    { kind: "verdict", label: "Verdict", values: ["pending", "violated"] },
  ],
};

describe("describeStep", () => {
  it("names the step, time, firing and each row's value", () => {
    // GIVEN a timeline of two states
    // WHEN the second is described
    const text = describeStep(timeline, 1);
    // THEN the line carries the step, the time, the transition and the values
    expect(text).toBe(
      "step 1 · time 0.5 · Arrive fired · Waiting: 6 · Waiting <= 5: does not hold · Verdict: broken",
    );
  });

  it("calls the first state the start, and gives nothing past the last", () => {
    // GIVEN the same timeline
    // THEN the first state reads as the start and an index past the end reads as empty
    expect(describeStep(timeline, 0)).toContain("start");
    expect(describeStep(timeline, 2)).toBe("");
  });
});

describe("metricPlotRange", () => {
  it("leaves a tenth of the span empty above the largest value", () => {
    // GIVEN a metric that runs from 0 to 10
    const row = { kind: "metric" as const, label: "Waiting", values: [0, 10], thresholds: [] };
    // WHEN its plot range is read
    const range = metricPlotRange(row);
    // THEN the top sits one tenth of the span above the largest value and the bottom is unchanged
    expect(range).toEqual({ low: 0, high: 11 });
  });

  it("leaves a flat metric as it is", () => {
    // GIVEN a metric that holds one value
    const row = { kind: "metric" as const, label: "Waiting", values: [4, 4], thresholds: [] };
    // THEN its plot range is that value alone
    expect(metricPlotRange(row)).toEqual({ low: 4, high: 4 });
  });
});

describe("metricRange", () => {
  it("spans the values and the thresholds, so a dashed line is never off the strip", () => {
    // GIVEN a metric that stays at or below 3 and is compared with 5
    const row = { kind: "metric" as const, label: "Waiting", values: [0, null, 3], thresholds: [5] };
    // WHEN its range is read
    // THEN it runs from 0 to the threshold, and a metric with no value and no threshold has none
    expect(metricRange(row)).toEqual({ low: 0, high: 5 });
    expect(metricRange({ ...row, values: [null], thresholds: [] })).toBeNull();
  });
});

describe("axisOf", () => {
  it("names the first and last step, and the times only when time advances", () => {
    // GIVEN a timeline whose time moves, and one whose time stands still
    const still: Timeline = { steps: [{ step: 0, time: 0, fired: null }, { step: 1, time: 0, fired: "A" }], rows: [] };
    // WHEN their axes are read
    // THEN the first has times at both ends and the second has none
    expect(axisOf(timeline)).toEqual({
      first: "step 0",
      last: "step 1",
      times: { first: "time 0", last: "time 0.5" },
    });
    expect(axisOf(still)?.times).toBeNull();
  });
});

describe("columnAt", () => {
  it("maps a pointer position to a column, and off the strip to null", () => {
    // GIVEN a strip 100 wide with 4 columns
    // THEN positions fall in their column, and outside the strip there is none
    expect(columnAt(0, 100, 4)).toBe(0);
    expect(columnAt(60, 100, 4)).toBe(2);
    expect(columnAt(99.9, 100, 4)).toBe(3);
    expect(columnAt(100, 100, 4)).toBeNull();
    expect(columnAt(-1, 100, 4)).toBeNull();
  });
});

describe("windowColumns", () => {
  const steps = [0, 3.9, 8.9, 9.2, 34.6].map((time, step) => ({ step, time, fired: null }));

  it("counts a state that began before the window and is still active when it opens", () => {
    // GIVEN a run of five states and a window from 10 to 20
    const timeline: Timeline = { steps, rows: [], window: { from: 10, to: 20 } };
    // WHEN the columns inside the window are read
    // THEN only the state that began at 9.2 and lasts to 34.6 is inside
    expect(windowColumns(timeline)).toEqual({ first: 3, last: 3 });
  });

  it("counts times from the first state, and gives nothing without a window or past the run", () => {
    // GIVEN a run that starts at time 5 and a window from 0 to 1
    const shifted: Timeline = {
      steps: [{ step: 0, time: 5, fired: null }, { step: 1, time: 5.5, fired: "A" }, { step: 2, time: 9, fired: "A" }],
      rows: [],
      window: { from: 0, to: 1 },
    };
    // THEN the first two states are inside, no window gives null, and a window after the last state gives null
    expect(windowColumns(shifted)).toEqual({ first: 0, last: 1 });
    expect(windowColumns({ ...shifted, window: undefined })).toBeNull();
    expect(windowColumns({ ...shifted, window: { from: 50, to: 60 } })).toBeNull();
  });
});
