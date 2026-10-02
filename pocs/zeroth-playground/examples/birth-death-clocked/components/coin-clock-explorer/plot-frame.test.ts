import { describe, expect, it } from "vitest";

import { curvePath, niceCeil, xOf, yOf } from "./plot-frame";

import type { PlotFrame } from "./plot-frame";

const FRAME: PlotFrame = { width: 120, height: 120, left: 10, right: 10, top: 10, bottom: 10, horizon: 4 };

describe("niceCeil", () => {
  it("rounds up to a round number", () => {
    // GIVEN round numbers, numbers between them, and zero
    // THEN a round number stays, and anything else goes up to the next one
    expect(niceCeil(3)).toBe(3);
    expect(niceCeil(3.1)).toBe(4);
    expect(niceCeil(0.75)).toBe(0.8);
    expect(niceCeil(12.5)).toBe(15);
    expect(niceCeil(0)).toBe(1);
  });
});

describe("xOf and yOf", () => {
  it("map time across and probability up, clamped to the frame", () => {
    // GIVEN a frame from 10 to 110 both ways, with a horizon of 4
    // THEN t = 2 sits halfway across, t = 9 at the edge, and probability 1 at the top
    expect(xOf(FRAME, 0)).toBe(10);
    expect(xOf(FRAME, 2)).toBe(60);
    expect(xOf(FRAME, 9)).toBe(110);
    expect(yOf(FRAME, 1)).toBe(10);
    expect(yOf(FRAME, 0)).toBe(110);
  });
});

describe("curvePath", () => {
  it("starts at the first sample and stops at the horizon", () => {
    // GIVEN a frame with a horizon of 4
    // WHEN a flat curve is drawn from 0 to 10 in four samples
    const path = curvePath(FRAME, () => 1, 0, 10, 4);
    // THEN it runs along the top up to the horizon, 4
    expect(path).toBe("M10,10L35,10L60,10L85,10L110,10");
  });

  it("is empty when the span starts past the horizon", () => {
    // GIVEN a frame that ends at 4
    // THEN a curve that starts at 5 draws nothing
    expect(curvePath(FRAME, () => 1, 5, 10)).toBe("");
  });
});
