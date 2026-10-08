import { describe, expect, it } from "vitest";

import { parsePetriNetIr } from "../compiler/ir/parse";
import { createRandom, simulate } from "./simulate";

import type { PetriNetIr } from "../compiler/ir/schema";

function net(yaml: string): PetriNetIr {
  const outcome = parsePetriNetIr(yaml);
  if (!outcome.ok) {
    throw new Error(`bad net: ${JSON.stringify(outcome.errors)}`);
  }
  return outcome.ir;
}

const SETTINGS = { seed: 1, maxSteps: 200 };

const DEADLOCK_NET = `
name: Drain
kind: plain
places:
  Pool: null
marking:
  Pool: 3
transitions:
  Take:
    inputs:
      Pool: null
`;

const WEIGHTED_NET = `
name: Weighted
kind: plain
places:
  Source: null
  Sink: null
marking:
  Source: 5
transitions:
  Move:
    inputs:
      Source: { weight: 2 }
    outputs:
      Sink: { weight: 3 }
`;

const READ_NET = `
name: ReadArc
kind: plain
places:
  Key: null
  Items: null
  Done: null
marking:
  Key: 1
  Items: 3
transitions:
  Use:
    inputs:
      Key: { kind: read }
      Items: null
    outputs:
      Done: null
`;

const INHIBITOR_NET = `
name: Inhibit
kind: plain
places:
  Stop: null
  Count: null
marking:
  Stop: 2
transitions:
  Tick:
    inputs:
      Stop: { kind: inhibitor, weight: 2 }
    outputs:
      Count: null
`;

const CAPACITY_NET = `
name: Capacity
kind: plain
places:
  Box:
    capacity: 3
transitions:
  Add:
    outputs:
      Box: null
`;

const CYCLE_NET = `
name: Cycle
kind: plain
places:
  A: null
  B: null
marking:
  A: 1
transitions:
  Forward:
    inputs:
      A: null
    outputs:
      B: null
  Back:
    inputs:
      B: null
    outputs:
      A: null
`;

const STOCHASTIC_NET = `
name: Ticker
kind: stochastic
places:
  Ticks: null
transitions:
  Tick:
    rate: 2
    outputs:
      Ticks: null
`;

describe("simulate", () => {
  it("stops at a deadlock when nothing is enabled", () => {
    // GIVEN a net that drains its only place
    const ir = net(DEADLOCK_NET);

    // WHEN it runs
    const result = simulate(ir, SETTINGS);

    // THEN it fires three times then stops with a deadlock
    expect(result.stopReason).toBe("deadlock");
    expect(result.states.map((state) => state.marking["Pool"])).toEqual([3, 2, 1, 0]);
    expect(result.states.map((state) => state.step)).toEqual([0, 1, 2, 3]);
    expect(result.states[3]?.fired).toEqual({ Take: 3 });
    expect(result.states[3]?.firedTransition).toBe("Take");
    expect(result.states[0]?.firedTransition).toBeUndefined();
  });

  it("stops at maxSteps", () => {
    // GIVEN a net that can fire forever
    const ir = net(CYCLE_NET);

    // WHEN it runs for 7 steps
    const result = simulate(ir, { seed: 1, maxSteps: 7 });

    // THEN it has 8 states and the reason is max-steps
    expect(result.stopReason).toBe("max-steps");
    expect(result.states).toHaveLength(8);
  });

  it("alternates through a two-transition cycle", () => {
    // GIVEN a token that moves around a loop
    const ir = net(CYCLE_NET);

    // WHEN it runs 4 steps
    const result = simulate(ir, { seed: 3, maxSteps: 4 });

    // THEN the firings alternate
    expect(result.states.map((state) => state.firedTransition)).toEqual([
      undefined,
      "Forward",
      "Back",
      "Forward",
      "Back",
    ]);
  });

  it("moves weighted arcs by their weight", () => {
    // GIVEN 5 tokens, an arc taking 2 and an arc giving 3
    const ir = net(WEIGHTED_NET);

    // WHEN it runs
    const result = simulate(ir, SETTINGS);

    // THEN it fires twice, then 1 token is too few
    expect(result.states.map((state) => [state.marking["Source"], state.marking["Sink"]])).toEqual([
      [5, 0],
      [3, 3],
      [1, 6],
    ]);
    expect(result.stopReason).toBe("deadlock");
  });

  it("tests a read arc without consuming", () => {
    // GIVEN a key read by a transition that consumes items
    const ir = net(READ_NET);

    // WHEN it runs
    const result = simulate(ir, SETTINGS);

    // THEN the key stays and the items run out
    const last = result.states[result.states.length - 1];
    expect(last?.marking).toEqual({ Key: 1, Items: 0, Done: 3 });
    expect(result.stopReason).toBe("deadlock");
  });

  it("does not fire a read arc whose place is short", () => {
    // GIVEN the same net with no key
    const ir = net(READ_NET.replace("Key: 1\n", "Key: 0\n"));

    // WHEN it runs
    const result = simulate(ir, SETTINGS);

    // THEN nothing fires
    expect(result.states).toHaveLength(1);
    expect(result.stopReason).toBe("deadlock");
  });

  it("enables an inhibitor arc only below its weight", () => {
    // GIVEN an inhibitor of weight 2 on a place holding 2
    const blocked = simulate(net(INHIBITOR_NET), SETTINGS);
    const open = simulate(net(INHIBITOR_NET.replace("Stop: 2", "Stop: 1")), { seed: 1, maxSteps: 3 });

    // WHEN both run
    // THEN the full place blocks it and the place holding 1 lets it fire
    expect(blocked.states).toHaveLength(1);
    expect(blocked.stopReason).toBe("deadlock");
    expect(open.states).toHaveLength(4);
    expect(open.states[3]?.marking["Count"]).toBe(3);
    expect(open.states[3]?.marking["Stop"]).toBe(1);
  });

  it("blocks a firing that would pass a capacity", () => {
    // GIVEN a producer into a place with capacity 3
    const ir = net(CAPACITY_NET);

    // WHEN it runs
    const result = simulate(ir, SETTINGS);

    // THEN the place fills to 3 and the run deadlocks
    expect(result.states.map((state) => state.marking["Box"])).toEqual([0, 1, 2, 3]);
    expect(result.stopReason).toBe("deadlock");
  });

  it("gives the same run for the same seed and another for a new seed", () => {
    // GIVEN a net with a random choice at each step
    const ir = net(`
name: Choice
kind: plain
places:
  Start: null
  Left: null
  Right: null
marking:
  Start: 20
transitions:
  GoLeft:
    inputs:
      Start: null
    outputs:
      Left: null
  GoRight:
    inputs:
      Start: null
    outputs:
      Right: null
`);

    // WHEN it runs twice with seed 5 and once with seed 6
    const first = simulate(ir, { seed: 5, maxSteps: 200 });
    const second = simulate(ir, { seed: 5, maxSteps: 200 });
    const other = simulate(ir, { seed: 6, maxSteps: 200 });

    // THEN the first two are identical and the third differs
    expect(second).toEqual(first);
    expect(other.states.map((state) => state.firedTransition)).not.toEqual(
      first.states.map((state) => state.firedTransition),
    );
    expect(first.states).toHaveLength(21);
  });

  it("chooses uniformly among enabled plain transitions", () => {
    // GIVEN two plain transitions that are always enabled
    const ir = net(`
name: Coin
kind: plain
places:
  Heads: null
  Tails: null
transitions:
  Head:
    outputs:
      Heads: null
  Tail:
    outputs:
      Tails: null
`);

    // WHEN it runs 2000 steps
    const result = simulate(ir, { seed: 11, maxSteps: 2000 });

    // THEN each fires close to half the time
    const heads = result.states[2000]?.marking["Heads"] ?? 0;
    expect(heads).toBeGreaterThan(900);
    expect(heads).toBeLessThan(1100);
  });

  it("advances time monotonically for stochastic transitions", () => {
    // GIVEN a stochastic clock
    const ir = net(STOCHASTIC_NET);

    // WHEN it runs 100 steps
    const result = simulate(ir, { seed: 2, maxSteps: 100 });

    // THEN time rises at every step, from 0
    const times = result.states.map((state) => state.time);
    expect(times[0]).toBe(0);
    expect(times.slice(1).every((time, index) => time > (times[index] ?? 0))).toBe(true);
  });

  it("waits about 1 over the rate on average", () => {
    // GIVEN a clock with rate 2
    const ir = net(STOCHASTIC_NET);

    // WHEN it runs 5000 steps
    const result = simulate(ir, { seed: 4, maxSteps: 5000 });

    // THEN the mean wait is close to 0.5
    const mean = (result.states[5000]?.time ?? 0) / 5000;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it("stops before the firing that would pass maxTime", () => {
    // GIVEN a clock and a time limit
    const ir = net(STOCHASTIC_NET);

    // WHEN it runs to time 3
    const result = simulate(ir, { seed: 2, maxSteps: 10000, maxTime: 3 });

    // THEN every state is within the limit and the reason is max-time
    expect(result.stopReason).toBe("max-time");
    expect(result.states.every((state) => state.time <= 3)).toBe(true);
    expect(result.states.length).toBeGreaterThan(1);
  });

  it("takes no time for plain firings, so maxTime never stops a plain net", () => {
    // GIVEN a plain net that can fire forever and a small maxTime
    const ir = net(CYCLE_NET);

    // WHEN it runs 5 firings with maxTime 0.001
    const result = simulate(ir, { seed: 1, maxSteps: 5, maxTime: 0.001 });

    // THEN it stops at maxSteps, with every state at time 0
    expect(result.stopReason).toBe("max-steps");
    expect(result.states).toHaveLength(6);
    expect(result.states.every((state) => state.time === 0)).toBe(true);
  });

  it("counts the firing into a state in that state's fired totals", () => {
    // GIVEN a net that drains three tokens
    const ir = net(DEADLOCK_NET);

    // WHEN it runs
    const result = simulate(ir, SETTINGS);

    // THEN fired is 0 at s0 and k at sk
    expect(result.states.map((state) => state.fired["Take"])).toEqual([0, 1, 2, 3]);
  });

  it("tells a deadlock from a cut at the same step", () => {
    // GIVEN a net that deadlocks after 3 firings
    const ir = net(DEADLOCK_NET);

    // WHEN maxSteps is 3 and then 2
    const atDeadlock = simulate(ir, { seed: 1, maxSteps: 3 });
    const cut = simulate(ir, { seed: 1, maxSteps: 2 });

    // THEN the first is a deadlock and the second a cut, with maxSteps + 1 states
    expect(atDeadlock.stopReason).toBe("deadlock");
    expect(atDeadlock.states).toHaveLength(4);
    expect(cut.stopReason).toBe("max-steps");
    expect(cut.states).toHaveLength(3);
  });

  it("splits firings among stochastic transitions in proportion to rate", () => {
    // GIVEN rates 9 and 1
    const ir = net(`
name: Race
kind: stochastic
places:
  Fast: null
  Slow: null
transitions:
  GoFast:
    rate: 9
    outputs:
      Fast: null
  GoSlow:
    rate: 1
    outputs:
      Slow: null
`);

    // WHEN it runs 4000 steps
    const result = simulate(ir, { seed: 8, maxSteps: 4000 });

    // THEN about 90 percent are the fast one
    const fast = result.states[4000]?.marking["Fast"] ?? 0;
    expect(fast).toBeGreaterThan(3500);
    expect(fast).toBeLessThan(3700);
  });

  it("fires plain transitions before stochastic ones", () => {
    // GIVEN a mixed net where a plain transition can fire 3 times
    const ir = net(`
name: Mixed
kind: mixed
places:
  Fuel: null
  Smoke: null
  Ticks: null
marking:
  Fuel: 3
transitions:
  Burn:
    inputs:
      Fuel: null
    outputs:
      Smoke: null
  Tick:
    rate: 1
    outputs:
      Ticks: null
`);

    // WHEN it runs 6 steps
    const result = simulate(ir, { seed: 1, maxSteps: 6 });

    // THEN the first 3 firings are Burn at time 0, then Tick
    expect(result.states.slice(1).map((state) => state.firedTransition)).toEqual([
      "Burn",
      "Burn",
      "Burn",
      "Tick",
      "Tick",
      "Tick",
    ]);
    expect(result.states[3]?.time).toBe(0);
    expect(result.states[4]?.time).toBeGreaterThan(0);
  });

  it("refuses a net with a guard, with no states beyond the first", () => {
    // GIVEN a transition with a guard
    const ir = net(`
name: Guarded
kind: plain
places:
  P: null
marking:
  P: 1
transitions:
  Go:
    guard: "return true;"
    inputs:
      P: null
`);

    // WHEN it runs
    const result = simulate(ir, SETTINGS);

    // THEN it is refused with one error and only s0
    expect(result.stopReason).toBe("refused");
    expect(result.states).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("guard");
  });

  it("refuses a rate written as code", () => {
    // GIVEN a rate that is a code string
    const ir = net(`
name: Coded
kind: stochastic
places:
  P: null
transitions:
  Go:
    rate: "return 2;"
    outputs:
      P: null
`);

    // WHEN it runs
    const result = simulate(ir, SETTINGS);

    // THEN it is refused
    expect(result.stopReason).toBe("refused");
    expect(result.diagnostics[0]?.message).toContain("rate");
    expect(result.states).toHaveLength(1);
  });

  it("refuses a coloured place", () => {
    // GIVEN a coloured place
    const ir = net(`
name: Colours
kind: plain
colours:
  Dot:
    size: real
places:
  P:
    colour: Dot
transitions:
  Go:
    outputs:
      P: null
    kernel: "return [{ size: 1 }];"
`);

    // WHEN it runs
    const result = simulate(ir, SETTINGS);

    // THEN it is refused for the place and the kernel
    expect(result.stopReason).toBe("refused");
    expect(result.diagnostics.map((diagnostic) => diagnostic.item).sort()).toEqual([
      "place P",
      "transition Go",
    ]);
  });
});

describe("createRandom", () => {
  it("gives numbers in [0, 1) that repeat for one seed", () => {
    // GIVEN two generators with one seed
    const first = createRandom(42);
    const second = createRandom(42);

    // WHEN each draws 100 numbers
    const a = Array.from({ length: 100 }, first);
    const b = Array.from({ length: 100 }, second);

    // THEN they match and stay in range
    expect(a).toEqual(b);
    expect(a.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});
