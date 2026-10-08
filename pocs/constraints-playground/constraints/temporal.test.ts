import { describe, expect, it } from "vitest";

import { parseConstraint } from "./constraint-parser";
import {
  HOLE_INFO,
  MONITOR_MISMATCH_ERROR,
  NOW_WINDOW_PAST_END_INFO,
  WINDOW_PAST_END_INFO,
  evaluate,
  margin,
} from "./evaluate";
import { createRandom } from "./simulate";
import { formulaOf } from "./formula";

import type { Constraint, ConstraintDocument, Verdict } from "./ast";
import type { EvaluateOptions } from "./evaluate";
import type { RunState } from "./simulate";

const P: Verdict = "pending";
const S: Verdict = "satisfied";
const V: Verdict = "violated";

/** A run from rows of [A, B, time]: places A and B hold the counts, at that run time. */
function run(rows: [number, number, number?][]): RunState[] {
  return rows.map(([a, b, time], step) => ({ step, time: time ?? 0, marking: { A: a, B: b }, fired: {} }));
}

function doc(text: string, maxTime?: number): ConstraintDocument {
  const parsed = parseConstraint(text, { mtl: true, nested: true });
  if (parsed.constraint === undefined) {
    throw new Error(`bad constraint "${text}": ${JSON.stringify(parsed.diagnostics)}`);
  }
  return {
    name: "test",
    metrics: [],
    constraint: parsed.constraint,
    run: { seed: 1, maxSteps: 200, ...(maxTime === undefined ? {} : { maxTime }) },
  };
}

function check(text: string, states: RunState[], options?: EvaluateOptions, maxTime?: number) {
  return evaluate(doc(text, maxTime), states, options);
}

describe("nested operators (finite-trace LTL)", () => {
  const response = "always(count(A) >= 1 implies eventually(count(B) >= 1))";

  it("violates the response rule at the end when the last A is never answered", () => {
    // GIVEN A at steps 0 and 2, B only at step 1
    const states = run([[1, 0], [0, 1], [1, 0], [0, 0]]);

    // WHEN it is evaluated
    const result = check(response, states);

    // THEN no prefix decides it (a B could still come), and the end violates it at step 2's A
    expect(result.check).toBe("monitor");
    expect(result.verdicts).toEqual([P, P, P, P]);
    expect(result.decidedAt).toBeNull();
    expect(result.finalVerdict).toBe(V);
    expect(result.formulaTruth).toEqual([false, false, false, true]);
  });

  it("satisfies the response rule at the end when every A is answered", () => {
    // GIVEN the same run, but B comes at step 3
    const states = run([[1, 0], [0, 1], [1, 0], [0, 1]]);

    // WHEN it is evaluated
    const result = check(response, states);

    // THEN it is satisfied by the end-of-run reading, never mid-run
    expect(result.decidedAt).toBeNull();
    expect(result.finalVerdict).toBe(S);
  });

  it("decides always-implies-always mid-run, at the first B that fails after an A", () => {
    // GIVEN A from step 1, B false at step 2
    const states = run([[0, 1], [1, 1], [1, 0], [1, 1]]);

    // WHEN always(A implies always B) is evaluated
    const result = check("always(count(A) >= 1 implies always(count(B) >= 1))", states);

    // THEN step 2 fixes the violation: no later state can repair it
    expect(result.verdicts).toEqual([P, P, V, V]);
    expect(result.decidedAt).toBe(2);
    expect(result.finalVerdict).toBe(V);
  });

  it("decides eventually-and-eventually mid-run, at the step that completes it", () => {
    // GIVEN A at step 1, then B at step 2
    const states = run([[0, 0], [1, 0], [0, 1]]);

    // WHEN eventually(A and eventually B) is evaluated
    const result = check("eventually(count(A) >= 1 and eventually(count(B) >= 1))", states);

    // THEN step 2 satisfies it
    expect(result.verdicts).toEqual([P, P, S]);
    expect(result.decidedAt).toBe(2);
  });

  it("reads eventually(always A) on a finite run as A at the last state", () => {
    // GIVEN one run that ends with A, and one that ends without
    const settles = run([[0, 0], [1, 0], [0, 0], [1, 0], [1, 0]]);
    const drops = run([[1, 0], [1, 0], [0, 0]]);

    // WHEN eventually(always A) is evaluated on each
    const settled = check("eventually(always(count(A) >= 1))", settles);
    const dropped = check("eventually(always(count(A) >= 1))", drops);

    // THEN only the end decides, and the last state settles it
    expect(settled.decidedAt).toBeNull();
    expect(settled.finalVerdict).toBe(S);
    expect(dropped.decidedAt).toBeNull();
    expect(dropped.finalVerdict).toBe(V);
  });

  it("reads strong and weak until with a nested goal", () => {
    // GIVEN A for two steps, and B from step 1 to the end
    const states = run([[1, 0], [1, 1], [0, 1], [0, 1]]);

    // WHEN until(A, always B) and until(A, always(B >= 2)) are evaluated
    const reached = check("until(count(A) >= 1, always(count(B) >= 1))", states);
    const never = check("until(count(A) >= 1, always(count(B) >= 2))", states);
    const weakNever = check("weak_until(count(A) >= 1, always(count(B) >= 2))", states);

    // THEN the first holds at the end; the second fails at step 2 when A drops; weak until fails there too
    expect(reached.decidedAt).toBeNull();
    expect(reached.finalVerdict).toBe(S);
    expect(never.decidedAt).toBe(2);
    expect(never.finalVerdict).toBe(V);
    expect(weakNever.finalVerdict).toBe(V);
  });
});

describe("now", () => {
  it("checks a state formula at the first state, decided at step 0", () => {
    // GIVEN A true at s0 only
    const states = run([[1, 0], [0, 0]]);

    // WHEN count(A) >= 1 is evaluated with no operator
    const result = check("count(A) >= 1", states);

    // THEN it is satisfied at step 0, whatever comes later
    expect(result.verdicts).toEqual([S, S]);
    expect(result.decidedAt).toBe(0);
    expect(result.finalVerdict).toBe(S);
  });

  it("decides temporal calls joined by logic at the first step that fixes them", () => {
    // GIVEN A first true at step 2, B never
    const states = run([[0, 0], [0, 0], [1, 0], [0, 0]]);

    // WHEN eventually(A) or B is evaluated
    const result = check("eventually(count(A) >= 1) or count(B) >= 1", states);

    // THEN step 2 satisfies it
    expect(result.decidedAt).toBe(2);
    expect(result.finalVerdict).toBe(S);
  });

  it("agrees with the base verdicts when a base constraint is joined with true", () => {
    // GIVEN many random runs and the four base operators
    const random = createRandom(7);
    const texts = [
      "always(count(A) >= 1)",
      "eventually(count(A) >= 1 and count(B) >= 1)",
      "until(count(A) >= 1, count(B) >= 1)",
      "weak_until(count(A) >= 1, count(B) >= 1)",
    ];
    for (let trial = 0; trial < 200; trial += 1) {
      const states = randomRun(random, 1 + Math.floor(random() * 6));
      for (const text of texts) {
        // WHEN the base constraint and the same formula as `now` (with "and true") are evaluated
        const v1 = check(text, states);
        const monitored = check(`${text} and true`, states);

        // THEN they give the same verdicts, step by step
        expect(monitored.check).toBe("monitor");
        expect(v1.check).toBe("online");
        expect(monitored.verdicts).toEqual(v1.verdicts);
        expect(monitored.decidedAt).toBe(v1.decidedAt);
        expect(monitored.finalVerdict).toBe(v1.finalVerdict);
      }
    }
  });
});

describe("windows (MTL, piecewise-constant time)", () => {
  it("violates a windowed eventually when the goal comes after the window", () => {
    // GIVEN A at time 40 only
    const states = run([[0, 0, 0], [0, 0, 10], [1, 0, 40]]);

    // WHEN eventually[0, 30] A and eventually A are evaluated
    const windowed = check("eventually[0, 30](count(A) >= 1)", states);
    const plain = check("eventually(count(A) >= 1)", states);

    // THEN the window is violated at step 2, when the clock passes 30; the plain rule is satisfied there
    expect(windowed.verdicts).toEqual([P, P, V]);
    expect(windowed.decidedAt).toBe(2);
    expect(plain.finalVerdict).toBe(S);
  });

  it("satisfies a windowed eventually when the goal comes inside the window", () => {
    // GIVEN A at time 25
    const states = run([[0, 0, 0], [0, 0, 10], [1, 0, 25]]);

    // WHEN eventually[0, 30] A is evaluated
    const result = check("eventually[0, 30](count(A) >= 1)", states);

    // THEN it is satisfied at step 2
    expect(result.decidedAt).toBe(2);
    expect(result.finalVerdict).toBe(S);
  });

  it("counts the state that is active when a window opens, though it began before", () => {
    // GIVEN state 1 holds from time 5 to 12, so it is active at 10
    const holds = run([[0, 0, 0], [1, 0, 5], [1, 0, 12], [0, 0, 30]]);
    const fails = run([[0, 0, 0], [0, 0, 5], [1, 0, 12], [0, 0, 30]]);

    // WHEN always[10, 20] A is evaluated on each
    const held = check("always[10, 20](count(A) >= 1)", holds);
    const failed = check("always[10, 20](count(A) >= 1)", fails);

    // THEN s0 and s3 lie outside [10, 20]; s1 and s2 decide; the pass is known at time 30, the fail when s1 ends
    expect(held.finalVerdict).toBe(S);
    expect(held.decidedAt).toBe(3);
    expect(failed.finalVerdict).toBe(V);
    expect(failed.decidedAt).toBe(2);
  });

  it("sees a state that lasts no time at its instant", () => {
    // GIVEN state 2 starts and ends at time 4 (a plain firing), with A false there
    const states = run([[1, 0, 0], [1, 0, 4], [0, 0, 4], [1, 0, 9]]);

    // WHEN always[0, 8] A is evaluated
    const result = check("always[0, 8](count(A) >= 1)", states);

    // THEN the zero-length state counts, and the rule is violated
    expect(result.finalVerdict).toBe(V);
  });

  it("asks the hold of until to last until the window opens", () => {
    // GIVEN B at state 1, which holds over [3, 12) and so is active when [5, 10] opens; A false at state 1
    const states = run([[1, 0, 0], [0, 1, 3], [0, 0, 12]]);

    // WHEN until[5, 10](A, B) and plain until(A, B) are evaluated
    const windowed = check("until[5, 10](count(A) >= 1, count(B) >= 1)", states);
    const plain = check("until(count(A) >= 1, count(B) >= 1)", states);

    // THEN the window needs A from 3 to 5 too, so it fails; plain until is met at step 1
    expect(windowed.finalVerdict).toBe(V);
    expect(plain.finalVerdict).toBe(S);
  });

  it("does not ask the hold at the goal state when that state starts inside the window", () => {
    // GIVEN A at states 0 and 1, B at state 2 which starts at 7, inside [5, 10]
    const states = run([[1, 0, 0], [1, 0, 3], [0, 1, 7], [0, 0, 12]]);

    // WHEN until[5, 10](A, B) is evaluated
    const result = check("until[5, 10](count(A) >= 1, count(B) >= 1)", states);

    // THEN it is satisfied at step 2
    expect(result.finalVerdict).toBe(S);
    expect(result.decidedAt).toBe(2);
  });

  it("satisfies weak until with a window when the hold covers the whole window", () => {
    // GIVEN A over [0, 20), B never
    const states = run([[1, 0, 0], [1, 0, 5], [0, 0, 20]]);

    // WHEN the strong and weak forms are evaluated with window [0, 10]
    const strong = check("until[0, 10](count(A) >= 1, count(B) >= 1)", states);
    const weak = check("weak_until[0, 10](count(A) >= 1, count(B) >= 1)", states);

    // THEN strong fails, weak holds
    expect(strong.finalVerdict).toBe(V);
    expect(weak.finalVerdict).toBe(S);
  });

  it("leaves a window that runs past the end to the top operator's end rule, with a note", () => {
    // GIVEN a run that deadlocks at time 10
    const states = run([[1, 0, 0], [1, 0, 10]]);

    // WHEN windows reaching to 50 are evaluated
    const always = check("always[0, 50](count(A) >= 1)", states, { stopReason: "deadlock" });
    const eventually = check("eventually[0, 50](count(A) >= 5)", states, { stopReason: "deadlock" });
    const now = check("eventually[0, 50](count(A) >= 5) or count(B) >= 1", states, { stopReason: "deadlock" });

    // THEN always passes and eventually fails at the end, and now has no verdict; each says why
    expect(always.formulaTruth?.[0]).toBe("unknown");
    expect(always.finalVerdict).toBe(S);
    expect(always.diagnostics).toEqual([{ severity: "info", message: WINDOW_PAST_END_INFO }]);
    expect(eventually.finalVerdict).toBe(V);
    expect(now.finalVerdict).toBe("pending");
    expect(now.diagnostics).toEqual([{ severity: "info", message: NOW_WINDOW_PAST_END_INFO }]);
  });

  it("keeps a false part of a window false though the window runs past the end", () => {
    // GIVEN A drops at time 5, and the run ends at 10
    const states = run([[1, 0, 0], [0, 0, 5], [0, 0, 10]]);

    // WHEN always[0, 50] A is evaluated
    const result = check("always[0, 50](count(A) >= 1)", states);

    // THEN the drop decides it at step 1, with no note
    expect(result.decidedAt).toBe(1);
    expect(result.finalVerdict).toBe(V);
    expect(result.diagnostics).toEqual([]);
  });

  it("lets the last state hold until maxTime when the run stopped there", () => {
    // GIVEN a run whose last firing is at time 10, stopped at maxTime 60
    const states = run([[1, 0, 0], [1, 0, 10]]);

    // WHEN always[0, 50] A is evaluated with and without the stop reason
    const stopped = check("always[0, 50](count(A) >= 1)", states, { stopReason: "max-time" }, 60);
    const unknown = check("always[0, 50](count(A) >= 1)", states, {}, 60);

    // THEN at max-time the window is inside the run and holds; without it, it runs past the end
    expect(stopped.endTime).toBe(60);
    expect(stopped.formulaTruth?.[0]).toBe(true);
    expect(stopped.diagnostics).toEqual([]);
    expect(unknown.endTime).toBe(10);
    expect(unknown.formulaTruth?.[0]).toBe("unknown");
  });

  it("degenerates on a run whose time never moves", () => {
    // GIVEN a plain run, every state at time 0
    const states = run([[1, 0], [1, 0], [0, 0]]);

    // WHEN windows from 0 and from 1 are evaluated
    const fromZero = check("always[0, 5](count(A) >= 1)", states);
    const plain = check("always(count(A) >= 1)", states);
    const later = check("eventually[1, 5](count(A) >= 1)", states);

    // THEN a window from 0 acts as no window, and a later window never starts
    expect(fromZero.verdicts).toEqual(plain.verdicts);
    expect(later.formulaTruth).toEqual(["unknown", "unknown", "unknown"]);
    expect(later.finalVerdict).toBe(V);
  });

  it("nests a window inside always, anchored at each state's own time", () => {
    // GIVEN breakdowns (A) at times 0 and 20, repairs (B) at 3 and 30
    const states = run([[1, 0, 0], [0, 1, 3], [1, 0, 20], [0, 1, 30], [0, 1, 40]]);

    // WHEN every breakdown must be repaired within 5 time units
    const result = check("always(count(A) >= 1 implies eventually[0, 5](count(B) >= 1))", states);

    // THEN the second repair is 10 late: violated at step 3, when the clock passes 25
    expect(result.decidedAt).toBe(3);
    expect(result.finalVerdict).toBe(V);
  });
});

describe("the online verdict for nested and windowed constraints", () => {
  const texts = [
    "always(count(A) >= 1 implies eventually(count(B) >= 1))",
    "eventually(always(count(A) >= 1))",
    "always(count(A) >= 1 implies always(count(B) >= 1))",
    "until(count(A) >= 1, eventually(count(B) >= 1))",
    "weak_until(not count(B) >= 1, always(count(A) >= 1))",
    "not eventually(count(A) >= 1 and count(B) >= 1)",
    "always[0, 3](count(A) >= 1) or eventually[2, 4](count(B) >= 1)",
    "always(count(A) >= 1 implies eventually[0, 2](count(B) >= 1))",
    "until[1, 3](count(A) >= 1, count(B) >= 1)",
    "weak_until[0, 2](count(A) >= 1, count(B) >= 1)",
    "eventually[1, 2](always[0, 1](count(A) >= 1))",
    "count(A) >= 1 iff eventually(count(B) >= 1)",
  ];

  it("is never contradicted by any later end of the run", () => {
    // GIVEN random runs with time steps of 0 to 2, some of length zero
    const random = createRandom(11);
    for (let trial = 0; trial < 300; trial += 1) {
      const states = randomRun(random, 1 + Math.floor(random() * 8));
      for (const text of texts) {
        // WHEN the constraint is evaluated on the run and on each of its prefixes, read as a whole run
        const whole = check(text, states);

        // THEN the verdict is monotonic, and once decided it is the final verdict of every longer prefix
        expect(whole.diagnostics.map((diagnostic) => diagnostic.message)).not.toContain(MONITOR_MISMATCH_ERROR);
        const firstDecided = whole.verdicts.findIndex((verdict) => verdict !== "pending");
        expect(firstDecided === -1 ? null : firstDecided).toBe(whole.decidedAt);
        if (whole.decidedAt !== null) {
          for (let end = whole.decidedAt; end < states.length; end += 1) {
            expect(check(text, states.slice(0, end + 1)).finalVerdict).toBe(whole.finalVerdict);
          }
        }
      }
    }
  });
});

describe("holes", () => {
  it("gives no verdict and says why", () => {
    // GIVEN constraints with an unfilled slot
    const states = run([[1, 0], [0, 0]]);

    // WHEN they are evaluated
    const whole = check("always(_)", states);
    const side = check("until(count(A) >= 1, _)", states);

    // THEN there is no verdict, no margin, and one info diagnostic
    for (const result of [whole, side]) {
      expect(result.incomplete).toBe(true);
      expect(result.check).toBe("none");
      expect(result.verdicts).toEqual([]);
      expect(result.finalVerdict).toBe("pending");
      expect(result.decidedAt).toBeNull();
      expect(result.diagnostics).toEqual([{ severity: "info", message: HOLE_INFO }]);
    }
    expect(margin(doc("always(_)"), states)).toBeNull();
    expect(HOLE_INFO).toBe("Fill every slot to get a verdict");
  });

  it("still reads the atoms that are filled in", () => {
    // GIVEN a hole beside an atom
    const result = check("always(count(A) >= 1 and _)", run([[1, 0], [0, 0]]));

    // THEN the atom's series is there
    expect(result.atoms.map((atom) => atom.truth)).toEqual([[true, false]]);
  });
});

describe("margin of nested and windowed constraints (provisional)", () => {
  it("takes min and max recursively", () => {
    // GIVEN A at margin 0 then -1, B at margin -2 then 1 (against >= 2)
    const states = run([[1, 0], [0, 3]]);

    // WHEN the response rule is measured
    const result = margin(doc("always(count(A) >= 1 implies eventually(count(B) >= 2))"), states);

    // THEN eventually B is 1 from both states, implies is 1 at both, always is 1
    expect(result).toEqual({ provisional: true, value: 1 });
  });

  it("takes the states a window touches", () => {
    // GIVEN A at 0, 2, 5 at times 0, 4, 9
    const states = run([[0, 0, 0], [2, 0, 4], [5, 0, 9]]);

    // WHEN eventually[0, 5](A >= 3) is measured
    const result = margin(doc("eventually[0, 5](count(A) >= 3)"), states);

    // THEN s0 and s1 count (margins -3 and -1), s2 at time 9 does not
    expect(result?.value).toBe(-1);
  });

  it("measures now at the first state", () => {
    // GIVEN A at 4 then 0
    const result = margin(doc("count(A) <= 5"), run([[4, 0], [0, 0]]));

    // THEN the margin is 5 - 4
    expect(result?.value).toBe(1);
  });
});

/** A random run of `length` states: A and B each 0 or 1, time steps of 0, 1 or 2. */
function randomRun(random: () => number, length: number): RunState[] {
  const rows: [number, number, number][] = [];
  let time = 0;
  for (let step = 0; step < length; step += 1) {
    if (step > 0) {
      time += Math.floor(random() * 3);
    }
    rows.push([random() < 0.5 ? 1 : 0, random() < 0.5 ? 1 : 0, time]);
  }
  return run(rows);
}

describe("formulaOf", () => {
  it("turns each constraint into one formula", () => {
    // GIVEN one constraint per top
    const constraints: Constraint[] = [
      doc("count(A) >= 1").constraint,
      doc("always[0, 2](count(A) >= 1)").constraint,
      doc("until(count(A) >= 1, count(B) >= 1)").constraint,
    ];

    // WHEN each is turned into a formula
    const formulas = constraints.map(formulaOf);

    // THEN now is its body, and the others keep their operator and window
    expect(formulas.map((formula) => formula.kind)).toEqual(["atom", "always", "until"]);
    expect(formulas[1]).toMatchObject({ window: { from: 0, to: 2 } });
  });
});
