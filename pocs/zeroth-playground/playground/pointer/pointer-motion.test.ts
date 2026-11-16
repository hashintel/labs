import { describe, expect, it } from "vitest";

import { NO_MOTION, restLeft, sampleMotion } from "./pointer-motion";

import type { PointerSample } from "./pointer-motion";

function motionOf(samples: PointerSample[]) {
  return samples.reduce(sampleMotion, NO_MOTION);
}

describe("sampleMotion", () => {
  it("counts a sweep as moving and a drift as resting", () => {
    // GIVEN a sweep of 10 px in 16 ms, and a drift of 1 px in 40 ms
    const sweep = [
      { x: 0, y: 0, t: 0 },
      { x: 10, y: 0, t: 16 },
    ];
    const drift = [
      { x: 0, y: 0, t: 0 },
      { x: 1, y: 0, t: 40 },
    ];
    // WHEN each is read as motion
    // THEN the sweep moved at its last sample, and the drift never moved
    expect(motionOf(sweep).movedAt).toBe(16);
    expect(motionOf(drift).movedAt).toBe(Number.NEGATIVE_INFINITY);
  });

  it("keeps the time of the last sweep through the drift that follows it", () => {
    // GIVEN a sweep at 10 ms, then a drift of 1 px in 40 ms
    const samples = [
      { x: 0, y: 0, t: 0 },
      { x: 30, y: 40, t: 10 },
      { x: 31, y: 40, t: 50 },
    ];
    // WHEN they are read as motion
    const motion = motionOf(samples);
    // THEN the pointer last moved at the sweep
    expect(motion.movedAt).toBe(10);
  });

  it("reads two samples at one timestamp as a millisecond apart", () => {
    // GIVEN a move of 2 px, and no move, each between two samples at 5 ms
    const move = [
      { x: 0, y: 0, t: 5 },
      { x: 2, y: 0, t: 5 },
    ];
    const still = [
      { x: 0, y: 0, t: 5 },
      { x: 0, y: 0, t: 5 },
    ];
    // WHEN each is read as motion
    // THEN the move counts as moving at 5 ms, and standing still does not
    expect(motionOf(move).movedAt).toBe(5);
    expect(motionOf(still).movedAt).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("restLeft", () => {
  it("waits out the rest of the pause after the last sweep", () => {
    // GIVEN a sweep that ends at 100 ms, and a pointer that never moved
    const motion = motionOf([
      { x: 0, y: 0, t: 0 },
      { x: 10, y: 0, t: 100 },
    ]);
    // WHEN a 30 ms rest is asked for at 110 ms and at 140 ms
    // THEN 20 ms are left at 110 ms, none at 140 ms, and none for a pointer that never moved
    expect(restLeft(motion, 110, 30)).toBe(20);
    expect(restLeft(motion, 140, 30)).toBe(0);
    expect(restLeft(NO_MOTION, 0, 30)).toBe(0);
  });
});
