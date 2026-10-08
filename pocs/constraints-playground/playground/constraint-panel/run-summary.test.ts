import { describe, expect, it } from "vitest";

import { evaluate, parseConstraint, parseMetricExpr } from "../../constraints";
import { passCondition, summarise, thresholdsOf } from "./run-summary";

import type { ConstraintDocument } from "../../constraints/ast";
import type { RunState } from "../../constraints";

function document(constraint: string): ConstraintDocument {
  const parsed = parseConstraint(constraint, { mtl: true, nested: true });
  if (parsed.constraint === undefined) {
    throw new Error(`bad constraint: ${JSON.stringify(parsed.diagnostics)}`);
  }
  return {
    name: "test",
    metrics: [{ name: "Waiting", expr: parseMetricExpr("count(A)").expr! }],
    constraint: parsed.constraint,
    run: { seed: 1, maxSteps: 200 },
  };
}

/** A run whose place A holds the given counts, and where Go has fired as many times as `fires` says by that step. */
function run(counts: number[], fires: number[] = []): RunState[] {
  return counts.map((a, step) => ({ step, time: step, marking: { A: a }, fired: { Go: fires[step] ?? 0 } }));
}

function sentence(constraint: string, states: RunState[]): string | null {
  const doc = document(constraint);
  return summarise(doc, evaluate(doc, states), states.length - 1);
}

describe("summarise", () => {
  it("names the step, the condition and the value that broke an always", () => {
    // GIVEN a metric that climbs past its limit at step 2
    // WHEN the run is summarised
    // THEN the sentence says where it broke and what the metric reached
    expect(sentence("always(Waiting <= 5)", run([0, 3, 6, 2]))).toBe("Broken at step 2: Waiting reached 6.");
  });

  it("says how many steps an always held, and that an eventually never came true", () => {
    // GIVEN runs of 3 steps after the first state
    // THEN an always that never broke held for all of them, and an eventually that never met says so
    expect(sentence("always(Waiting <= 5)", run([0, 1, 2, 3]))).toBe("Held for all 3 steps.");
    expect(sentence("eventually(Waiting >= 9)", run([0, 1, 2, 3]))).toBe("Never met in 3 steps.");
  });

  it("names the firing that met an eventually", () => {
    // GIVEN a transition that fires at step 1
    // THEN the sentence is "Met at step 1" with the transition
    expect(sentence("eventually(fired(Go) >= 1)", run([0, 0, 0], [0, 1, 1]))).toBe("Met at step 1: Go fired.");
  });

  it("blames the condition that fails inside an and, and the consequent of an implies", () => {
    // GIVEN an and whose second part fails, and an implies whose antecedent holds and consequent fails
    // THEN each sentence names the failing condition
    expect(sentence("always(Waiting <= 5 and Waiting >= 2)", run([3, 1]))).toBe("Broken at step 1: Waiting fell to 1.");
    expect(sentence("always(Waiting >= 1 implies Waiting <= 2)", run([0, 3]))).toBe("Broken at step 1: Waiting reached 3.");
  });
});

describe("thresholdsOf", () => {
  it("lists each value the rule compares the metric with, once", () => {
    // GIVEN a rule that compares Waiting with 5 twice and with 2 once
    const doc = document("always(Waiting <= 5 and (Waiting >= 2 or Waiting != 5))");
    // WHEN the thresholds of Waiting are read
    // THEN each value appears once, in reading order
    expect(thresholdsOf(doc, "Waiting")).toEqual([5, 2]);
  });
});

describe("passCondition", () => {
  const pass = (constraint: string) => passCondition(document(constraint).constraint);

  it("states the win condition of each top operator, the conditions in code", () => {
    // GIVEN one rule per top operator
    // WHEN each win condition is written
    // THEN each reads from its operator, with the conditions in backticks
    expect(pass("always(Waiting <= 5)")).toBe("Passes if `Waiting ≤ 5` at every step");
    expect(pass("eventually(fired(Restock) >= 1)")).toBe("Passes if `fired(Restock) ≥ 1` at some step");
    expect(pass("until(Waiting < 2, Waiting >= 4)")).toBe(
      "Passes if `Waiting ≥ 4` happens, with `Waiting < 2` true at every step before it",
    );
    expect(pass("weak_until(Waiting < 2, Waiting >= 4)")).toBe(
      "Passes if `Waiting < 2` stays true until `Waiting ≥ 4` happens, or to the end of the run",
    );
    expect(pass("Waiting == 1")).toBe("Passes if `Waiting = 1` at step 0");
  });

  it("adds the time window, and prints a nested body as code", () => {
    // GIVEN a windowed always, a windowed until, and an always over a nested eventually
    // WHEN their win conditions are written
    // THEN the window follows the step wording, and the body keeps its nesting
    expect(pass("always[10, 20](Waiting <= 5)")).toBe("Passes if `Waiting ≤ 5` at every step between time 10 and 20");
    expect(pass("until[0, 9](Waiting < 2, Waiting >= 4)")).toBe(
      "Passes if `Waiting ≥ 4` happens between time 0 and 9, with `Waiting < 2` true at every step before it",
    );
    expect(pass("always(Waiting == 1 implies eventually(Waiting == 2))")).toBe(
      "Passes if `Waiting = 1 implies EVENTUALLY (Waiting = 2)` at every step",
    );
  });
});
