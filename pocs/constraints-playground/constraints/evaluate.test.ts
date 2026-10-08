import { describe, expect, it } from "vitest";

import { parseConstraint } from "./constraint-parser";
import { evaluate, margin } from "./evaluate";
import { parseMetricExpr } from "./metric-parser";

import type { ConstraintDocument, Verdict } from "./ast";
import type { RunState } from "./simulate";

/** A run of states whose places A and B hold the given counts, and Go has fired as given. */
function states(rows: [number, number, number?][]): RunState[] {
  return rows.map(([a, b, go], step) => ({
    step,
    time: step,
    marking: { A: a, B: b },
    fired: { Go: go ?? 0 },
  }));
}

function document(
  constraint: string,
  metrics: Record<string, string> = {},
): ConstraintDocument {
  const parsed = parseConstraint(constraint, { mtl: true, nested: true });
  if (!parsed.constraint) {
    throw new Error(`bad constraint: ${JSON.stringify(parsed.diagnostics)}`);
  }
  return {
    name: "test",
    metrics: Object.entries(metrics).map(([name, text]) => ({
      name,
      expr: parseMetricExpr(text).expr!,
    })),
    constraint: parsed.constraint,
    run: { seed: 1, maxSteps: 200 },
  };
}

const P: Verdict = "pending";
const S: Verdict = "satisfied";
const V: Verdict = "violated";

describe("verdicts: always", () => {
  const always = document("always count(A) > 0");

  it("is violated at the first state where the body is false", () => {
    // GIVEN a run where A drops to 0 at step 2 and comes back
    const run = states([[1, 0], [1, 0], [0, 0], [1, 0]]);

    // WHEN it is evaluated
    const result = evaluate(always, run);

    // THEN it is pending twice, then violated for good
    expect(result.verdicts).toEqual([P, P, V, V]);
    expect(result.decidedAt).toBe(2);
    expect(result.finalVerdict).toBe(V);
  });

  it("is violated at step 0 when the first state fails", () => {
    // GIVEN a run that starts with A at 0
    const result = evaluate(always, states([[0, 0], [1, 0]]));

    // THEN it is violated at once
    expect(result.verdicts).toEqual([V, V]);
    expect(result.decidedAt).toBe(0);
  });

  it("stays pending while the body holds, then is satisfied at the end of the run", () => {
    // GIVEN a run where A is always positive
    const result = evaluate(always, states([[1, 0], [2, 0], [3, 0]]));

    // THEN the online verdict is pending throughout and the end-of-run rule satisfies it
    expect(result.verdicts).toEqual([P, P, P]);
    expect(result.decidedAt).toBeNull();
    expect(result.finalVerdict).toBe(S);
  });
});

describe("verdicts: eventually", () => {
  const eventually = document("eventually count(A) > 0");

  it("is satisfied at the first state where the body is true", () => {
    // GIVEN a run where A becomes positive at step 2 and drops again
    const result = evaluate(eventually, states([[0, 0], [0, 0], [1, 0], [0, 0]]));

    // THEN it is satisfied from step 2 on
    expect(result.verdicts).toEqual([P, P, S, S]);
    expect(result.decidedAt).toBe(2);
    expect(result.finalVerdict).toBe(S);
  });

  it("is satisfied at step 0 when the first state holds", () => {
    // GIVEN a run that starts with A positive
    const result = evaluate(eventually, states([[1, 0], [0, 0]]));

    // THEN it is satisfied at once
    expect(result.decidedAt).toBe(0);
    expect(result.verdicts).toEqual([S, S]);
  });

  it("stays pending while the body is false, then is violated at the end of the run", () => {
    // GIVEN a run where A never becomes positive
    const result = evaluate(eventually, states([[0, 0], [0, 0]]));

    // THEN the online verdict is pending and the end-of-run rule violates it
    expect(result.verdicts).toEqual([P, P]);
    expect(result.decidedAt).toBeNull();
    expect(result.finalVerdict).toBe(V);
  });
});

describe("verdicts: until", () => {
  const until = document("count(A) > 0 until count(B) > 0");

  it("is satisfied when the goal is true and the hold was true before", () => {
    // GIVEN A holds for two states, then B comes
    const result = evaluate(until, states([[1, 0], [1, 0], [1, 1], [0, 0]]));

    // THEN it is satisfied at step 2 and stays so
    expect(result.verdicts).toEqual([P, P, S, S]);
    expect(result.decidedAt).toBe(2);
  });

  it("is satisfied at step 0 when the goal holds, whatever the hold", () => {
    // GIVEN B true and A false at s0
    const result = evaluate(until, states([[0, 1], [0, 0]]));

    // THEN the goal is checked first and the run is satisfied
    expect(result.verdicts).toEqual([S, S]);
    expect(result.decidedAt).toBe(0);
  });

  it("checks the goal before the hold in the same state", () => {
    // GIVEN A false and B true in the same state, after A held
    const result = evaluate(until, states([[1, 0], [0, 1]]));

    // THEN it is satisfied, not violated
    expect(result.verdicts).toEqual([P, S]);
  });

  it("is violated when the hold and the goal are both false", () => {
    // GIVEN A drops with B still false
    const result = evaluate(until, states([[1, 0], [0, 0], [1, 1]]));

    // THEN it is violated at step 1 and a later B does not undo it
    expect(result.verdicts).toEqual([P, V, V]);
    expect(result.decidedAt).toBe(1);
    expect(result.finalVerdict).toBe(V);
  });

  it("is violated at step 0 when the hold and the goal are both false at s0", () => {
    // GIVEN neither A nor B at s0
    const result = evaluate(until, states([[0, 0]]));

    // THEN it is violated at step 0
    expect(result.verdicts).toEqual([V]);
    expect(result.decidedAt).toBe(0);
  });

  it("stays pending while the hold is true and the goal false, then is violated at the end", () => {
    // GIVEN B never comes
    const result = evaluate(until, states([[1, 0], [2, 0]]));

    // THEN it is pending, and the end-of-run rule violates it
    expect(result.verdicts).toEqual([P, P]);
    expect(result.decidedAt).toBeNull();
    expect(result.finalVerdict).toBe(V);
  });

  it("does not change once satisfied", () => {
    // GIVEN B comes at step 1 and A and B both fail at step 2
    const result = evaluate(until, states([[1, 0], [1, 1], [0, 0]]));

    // THEN the verdict stays satisfied
    expect(result.verdicts).toEqual([P, S, S]);
  });
});

describe("verdicts: weak until", () => {
  const weak = document("count(A) > 0 weak until count(B) > 0");

  it("decides like until when the goal comes", () => {
    // GIVEN A holds, then B
    const result = evaluate(weak, states([[1, 0], [1, 1]]));

    // THEN it is satisfied at step 1
    expect(result.verdicts).toEqual([P, S]);
    expect(result.decidedAt).toBe(1);
  });

  it("decides like until when the hold and the goal both fail", () => {
    // GIVEN A drops with B false
    const result = evaluate(weak, states([[1, 0], [0, 0]]));

    // THEN it is violated at step 1
    expect(result.verdicts).toEqual([P, V]);
    expect(result.finalVerdict).toBe(V);
  });

  it("is satisfied at the end of the run when the hold held throughout", () => {
    // GIVEN B never comes but A always holds
    const result = evaluate(weak, states([[1, 0], [1, 0], [2, 0]]));

    // THEN it is pending, then satisfied by the end-of-run rule
    expect(result.verdicts).toEqual([P, P, P]);
    expect(result.decidedAt).toBeNull();
    expect(result.finalVerdict).toBe(S);
  });

  it("is satisfied at step 0 when the goal holds at s0", () => {
    // GIVEN B at s0 with A false
    const result = evaluate(weak, states([[0, 1]]));

    // THEN it is satisfied at 0
    expect(result.verdicts).toEqual([S]);
  });
});

describe("verdicts: edge cases", () => {
  it("stays pending on an empty run", () => {
    // GIVEN no states
    const result = evaluate(document("always count(A) > 0"), []);

    // THEN there is nothing to decide
    expect(result.verdicts).toEqual([]);
    expect(result.finalVerdict).toBe(P);
    expect(result.decidedAt).toBeNull();
  });
});

describe("evaluate: state constraints", () => {
  it("evaluates and, or, not, implies and iff", () => {
    // GIVEN four states over A and B
    const run = states([[0, 0], [1, 0], [0, 1], [1, 1]]);
    const truthOf = (text: string) => evaluate(document(`always ${text}`), run).truth.body;

    // WHEN each connective is evaluated
    // THEN each column matches its truth table
    expect(truthOf("count(A) > 0 and count(B) > 0")).toEqual([false, false, false, true]);
    expect(truthOf("count(A) > 0 or count(B) > 0")).toEqual([false, true, true, true]);
    expect(truthOf("not count(A) > 0")).toEqual([true, false, true, false]);
    expect(truthOf("count(A) > 0 implies count(B) > 0")).toEqual([true, false, true, true]);
    expect(truthOf("count(A) > 0 iff count(B) > 0")).toEqual([true, false, false, true]);
  });

  it("evaluates if then else and if then", () => {
    // GIVEN four states over A and B
    const run = states([[0, 0], [1, 0], [0, 1], [1, 1]]);
    const truthOf = (text: string) => evaluate(document(`always ${text}`), run).truth.body;

    // WHEN the two forms are evaluated
    // THEN if A then B else not B, and if A then B
    expect(truthOf("if count(A) > 0 then count(B) > 0 else not count(B) > 0")).toEqual([
      true,
      false,
      false,
      true,
    ]);
    expect(truthOf("if count(A) > 0 then count(B) > 0")).toEqual([true, false, true, true]);
  });

  it("evaluates every comparator", () => {
    // GIVEN A is 3 in one state
    const run = states([[3, 0]]);
    const truthOf = (op: string) =>
      evaluate(document(`always count(A) ${op} 3`), run).truth.body?.[0];

    // WHEN each comparator tests against 3
    // THEN the answers follow
    expect(["<", "<=", ">", ">=", "==", "!="].map(truthOf)).toEqual([
      false,
      true,
      false,
      true,
      true,
      false,
    ]);
  });

  it("reports hold and goal truth for until", () => {
    // GIVEN an until over two states
    const result = evaluate(
      document("count(A) > 0 until count(B) > 0"),
      states([[1, 0], [0, 1]]),
    );

    // THEN truth has hold and goal and no body
    expect(result.truth).toEqual({ hold: [true, false], goal: [false, true] });
  });
});

describe("evaluate: metrics and atoms", () => {
  it("returns the value of every metric at every state", () => {
    // GIVEN a metric over a count and fired, and one over that metric
    const doc = document("always Load <= 5", {
      Load: "count(A) + count(B)",
      Rate: "Load * 2 + fired(Go)",
    });

    // WHEN it is evaluated
    const result = evaluate(doc, states([[1, 1, 0], [2, 3, 1]]));

    // THEN both series hold a value per state
    expect(result.metrics).toEqual([
      { name: "Load", values: [2, 5] },
      { name: "Rate", values: [4, 11] },
    ]);
  });

  it("returns each distinct atom once with its values and truth", () => {
    // GIVEN the same atom written twice and one other
    const doc = document("always (count(A) > 1 and count(B) > 0) or count(A) > 1", {});

    // WHEN it is evaluated
    const result = evaluate(doc, states([[2, 0], [0, 1]]));

    // THEN there are two atoms
    expect(result.atoms.map((atom) => atom.text)).toEqual(["count(A) > 1", "count(B) > 0"]);
    expect(result.atoms[0]?.lhs).toEqual([2, 0]);
    expect(result.atoms[0]?.truth).toEqual([true, false]);
    expect(result.atoms[1]?.truth).toEqual([false, true]);
  });

  it("gives a diagnostic and null for a division by zero", () => {
    // GIVEN a ratio whose divisor is zero at step 0
    const doc = document("always Ratio < 5", { Ratio: "count(A) / count(B)" });

    // WHEN it is evaluated
    const result = evaluate(doc, states([[1, 0], [4, 2]]));

    // THEN the value is null at step 0, the atom is false there, and one error says so
    expect(result.metrics[0]?.values).toEqual([null, 2]);
    expect(result.atoms[0]?.truth).toEqual([false, true]);
    expect(result.diagnostics).toEqual([
      { severity: "error", message: "Division by zero in Ratio, first at step 0" },
    ]);
  });

  it("makes every atom that reads an uncomputable metric false, even under not", () => {
    // GIVEN a ratio that divides by zero at step 0, read by an atom and by a negated atom
    const doc = document("always not Ratio > 5 and Ratio <= 5", { Ratio: "count(A) / count(B)" });

    // WHEN it is evaluated
    const result = evaluate(doc, states([[1, 0], [4, 2]]));

    // THEN both atoms are false at step 0, the body is false there, and one error is reported
    expect(result.atoms.map((atom) => atom.truth[0])).toEqual([false, false]);
    expect(result.truth.body).toEqual([false, true]);
    expect(result.finalVerdict).toBe(V);
    expect(result.decidedAt).toBe(0);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("never lets a negated uncomputable atom make the formula hold", () => {
    // GIVEN a ratio that divides by zero at step 0 and is 0.25 at step 1, under not
    const doc = document("eventually not Ratio >= 0.5", { Ratio: "count(A) / count(B)" });

    // WHEN it is evaluated
    const result = evaluate(doc, states([[0, 0], [1, 4]]));

    // THEN step 0 does not satisfy it; step 1 does, where the ratio is known
    expect(result.truth.body).toEqual([false, true]);
    expect(result.decidedAt).toBe(1);
  });

  it("reads an uncomputable atom as false on either side of implies and iff", () => {
    // GIVEN a ratio that divides by zero, on the left of implies and inside iff
    const implies = document("always Ratio > 1 implies count(A) > 5", { Ratio: "count(A) / count(B)" });
    const iff = document("always Ratio > 1 iff count(A) > 5", { Ratio: "count(A) / count(B)" });

    // WHEN both are evaluated at a state where the ratio cannot be computed
    const run = states([[0, 0]]);

    // THEN neither holds there: the error never satisfies the rule
    expect(evaluate(implies, run).truth.body).toEqual([false]);
    expect(evaluate(iff, run).truth.body).toEqual([false]);
  });

  it("reports an unknown place once", () => {
    // GIVEN an atom on a place the run does not have
    const doc = document("always count(Missing) > 0");

    // WHEN it is evaluated over three states
    const result = evaluate(doc, states([[0, 0], [0, 0], [0, 0]]));

    // THEN one diagnostic names it
    expect(result.diagnostics).toEqual([
      { severity: "error", message: "Unknown place Missing, first at step 0" },
    ]);
  });

  it("reports a metric cycle instead of looping", () => {
    // GIVEN two metrics that read each other
    const doc = document("always One > 0", { One: "Two + 1", Two: "One + 1" });

    // WHEN it is evaluated
    const result = evaluate(doc, states([[0, 0]]));

    // THEN it ends with a diagnostic and null values
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.metrics[0]?.values).toEqual([null]);
  });
});

describe("margin (provisional)", () => {
  it("is marked provisional", () => {
    // GIVEN any constraint
    // WHEN its margin is read
    const result = margin(document("always count(A) >= 2"), states([[3, 0]]))!;

    // THEN it says it is provisional
    expect(result.provisional).toBe(true);
  });

  it("gives x - c for at least and above, c - x for at most and below", () => {
    // GIVEN A is 3
    const run = states([[3, 0]]);
    const marginOf = (text: string) => margin(document(`always ${text}`), run)!.value;

    // WHEN each atom's margin is read
    // THEN the signed distance follows the comparator
    expect(marginOf("count(A) >= 2")).toBe(1);
    expect(marginOf("count(A) > 5")).toBe(-2);
    expect(marginOf("count(A) <= 5")).toBe(2);
    expect(marginOf("count(A) < 1")).toBe(-2);
    expect(marginOf("count(A) == 5")).toBe(-2);
    expect(marginOf("count(A) != 5")).toBe(2);
  });

  it("combines with min, max, negation and implies", () => {
    // GIVEN A is 3 and B is 1
    const run = states([[3, 1]]);
    const marginOf = (text: string) => margin(document(`always ${text}`), run)!.value;

    // WHEN compound constraints are measured
    // THEN and is min, or is max, not negates, implies is max(-a, b)
    expect(marginOf("count(A) >= 0 and count(B) >= 0")).toBe(1);
    expect(marginOf("count(A) >= 0 or count(B) >= 0")).toBe(3);
    expect(marginOf("not count(A) >= 0")).toBe(-3);
    expect(marginOf("count(A) >= 0 implies count(B) >= 5")).toBe(-3);
  });

  it("takes the min over states for always and the max for eventually", () => {
    // GIVEN A takes 5, 2, 4
    const run = states([[5, 0], [2, 0], [4, 0]]);

    // WHEN both operators measure count(A) >= 0
    const always = margin(document("always count(A) >= 0"), run)!.value;
    const eventually = margin(document("eventually count(A) >= 0"), run)!.value;

    // THEN the extremes are 2 and 5
    expect(always).toBe(2);
    expect(eventually).toBe(5);
  });

  it("takes the best over k of the goal and the earlier holds for until", () => {
    // GIVEN A is 4, 1, 3 and B is 0, 2, 9 and the goal needs B >= 0
    const run = states([[4, 0], [1, 2], [3, 9]]);

    // WHEN until is measured
    const value = margin(document("count(A) >= 0 until count(B) >= 0"), run)!.value;

    // THEN k=0 gives min(0, none)=0, k=1 gives min(2, 4)=2, k=2 gives min(9, min(4, 1))=1
    expect(value).toBe(2);
  });

  it("lets weak until fall back on the hold margin", () => {
    // GIVEN B is far from true and A holds with margin 1 throughout
    const run = states([[1, 0], [1, 0]]);

    // WHEN both until forms are measured
    const strong = margin(document("count(A) >= 0 until count(B) >= 5"), run)!.value;
    const weak = margin(document("count(A) >= 0 weak until count(B) >= 5"), run)!.value;

    // THEN until is negative and weak until is the hold margin
    expect(strong).toBe(-5);
    expect(weak).toBe(1);
  });
});
