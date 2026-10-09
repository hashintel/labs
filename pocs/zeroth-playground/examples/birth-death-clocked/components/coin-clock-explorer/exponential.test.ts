import { describe, expect, it } from "vitest";

import {
  delayFromDraw,
  effectiveRate,
  fireModifier,
  fireProbability,
  firesAt,
  survival,
  threshold,
} from "./exponential";
import { fixed } from "./format";

const RATES = [0.2, 0.5, 1, 2, 2.5, 4];
const STEPS = [0.05, 0.25, 0.5, 1, 2];

describe("survival", () => {
  it("starts at one and decays as e^(-λt)", () => {
    // GIVEN rates 1 and 2, at times 0, 0.5 and 1
    // THEN nothing has expired at 0, and only λt matters
    expect(survival(2, 0)).toBe(1);
    expect(survival(1, 1)).toBeCloseTo(Math.exp(-1), 12);
    expect(survival(2, 0.5)).toBeCloseTo(survival(1, 1), 12);
  });
});

describe("threshold and fire probability", () => {
  it("read the queue's Arrive at rate 2.5 and dt 0.5 as the compiler does", () => {
    // GIVEN Arrive's rate and the queue's time step
    // THEN the threshold is the one in the Python, and the chance is its complement
    expect(threshold(2.5, 0.5)).toBeCloseTo(0.2865047968601901, 15);
    expect(fireProbability(2.5, 0.5)).toBeCloseTo(0.7134952031398099, 15);
  });

  it("split the unit interval between waiting and firing", () => {
    // GIVEN every rate and step
    for (const lambda of RATES) {
      for (const dt of STEPS) {
        // THEN θ and p add up to one
        expect(threshold(lambda, dt) + fireProbability(lambda, dt)).toBeCloseTo(1, 14);
      }
    }
  });
});

describe("delayFromDraw", () => {
  it("inverts the survival: u = S(τ)", () => {
    // GIVEN draws across (0, 1]
    for (const lambda of RATES) {
      for (const u of [0.01, 0.2, 0.5, 0.9, 1]) {
        // WHEN a draw is read as a delay
        const tau = delayFromDraw(lambda, u);
        // THEN the survival at that delay is the draw
        expect(survival(lambda, tau)).toBeCloseTo(u, 12);
      }
    }
  });

  it("averages to the mean delay 1/λ over the draws", () => {
    // GIVEN draws spread evenly over (0, 1]
    const n = 100_000;
    // WHEN each is read as a delay at rate 2
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += delayFromDraw(2, (i + 0.5) / n);
    }
    // THEN the delays average to 1/2
    expect(sum / n).toBeCloseTo(0.5, 3);
  });
});

describe("coin and clock", () => {
  it("decide the same for every draw: u ≥ θ exactly when τ ≤ dt", () => {
    // GIVEN every rate, step and a fine grid of draws
    const draws = Array.from({ length: 2000 }, (_, i) => (i + 1) / 2000);
    // WHEN each draw is read both as a coin and as a clock
    const disagreements = RATES.flatMap((lambda) =>
      STEPS.flatMap((dt) =>
        draws
          .filter((u) => (delayFromDraw(lambda, u) <= dt) !== firesAt(u, threshold(lambda, dt)))
          .map((u) => ({ lambda, dt, u })),
      ),
    );
    // THEN the clock expires within the step exactly when the coin fires
    expect(disagreements).toEqual([]);
  });
});

describe("effectiveRate", () => {
  it("stays below λ for every step", () => {
    // GIVEN every rate and step
    for (const lambda of RATES) {
      for (const dt of STEPS) {
        // THEN a coin that fires at most once per step falls short of λ
        expect(effectiveRate(lambda, dt)).toBeLessThan(lambda);
      }
    }
  });

  it("rises towards λ as the step shrinks", () => {
    // GIVEN steps that shrink by orders of magnitude
    // WHEN the coin's rate is read at each
    const rates = [1, 0.5, 0.1, 0.01, 0.0001].map((dt) => effectiveRate(2, dt));
    // THEN it rises at every step and ends within 0.001 of λ = 2
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeGreaterThan(rates[i - 1] ?? 0);
    }
    expect(rates.at(-1)).toBeCloseTo(2, 3);
  });

  it("prints below λ = 2 with two decimals over the Δt slider", () => {
    // GIVEN every step the slider offers, 0.05 to 2 by 0.05
    for (let d = 1; d <= 40; d++) {
      // WHEN the readout prints the coin's rate at Birth's λ = 2
      const printed = Number(fixed(effectiveRate(2, d / 20), 2));
      // THEN it reads below λ
      expect(printed).toBeLessThan(2);
    }
  });
});

describe("firesAt", () => {
  it("fires on the threshold and above, waits below", () => {
    // GIVEN a threshold of 0.5, and draws on it, above it and below it
    // THEN the test is u ≥ θ
    expect(firesAt(0.5, 0.5)).toBe(true);
    expect(firesAt(0.6, 0.5)).toBe(true);
    expect(firesAt(0.4, 0.5)).toBe(false);
  });
});

describe("fireModifier", () => {
  it("names the reading of a draw, and nothing without one", () => {
    // GIVEN a threshold of 0.5, and no draw, a draw above it and one below it
    // THEN a draw reads as fires or waits, and no draw as nothing
    expect(fireModifier(undefined, 0.5)).toBeUndefined();
    expect(fireModifier(0.7, 0.5)).toBe("fires");
    expect(fireModifier(0.2, 0.5)).toBe("waits");
  });
});
