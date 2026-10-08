import { describe, expect, it } from "vitest";

import { parseConstraint } from "./constraint-parser";
import { evaluate } from "./evaluate";
import { parseMetricExpr } from "./metric-parser";
import { printConstraint, printMath, printMetricExpr } from "./printer";

import type { Constraint, StateExpr } from "./ast";
import type { RunState } from "./simulate";

function parsed(text: string): Constraint {
  const { constraint, diagnostics } = parseConstraint(text, { mtl: true, nested: true });
  if (!constraint) {
    throw new Error(`did not parse "${text}": ${JSON.stringify(diagnostics)}`);
  }
  return constraint;
}

const ROUND_TRIP_CASES = [
  "always(Waiting <= 5)",
  "eventually(count(Done) >= 1)",
  "always(fired(Go) != 0)",
  "always(A > -2.5)",
  "always(count(PlaceA) >= count(PlaceB))",
  "always(count(Van) <= fired(Scan))",
  "always(A != B and fired(Go) == count(C))",
  "A >= B until count(C) < fired(Go)",
  "always(not A > 0)",
  "always(not not A > 0)",
  "always(not (A > 0 and B > 0))",
  "always(A > 0 and B > 0 and C > 0)",
  "always((A > 0 and B > 0) or C > 0)",
  "always(A > 0 and (B > 0 or C > 0))",
  "always((A > 0 or B > 0) and (C > 0 or A > 0))",
  "always(A > 0 and (B > 0 and C > 0))",
  "always(A > 0 or (B > 0 or C > 0))",
  "always(A > 0 implies B > 0)",
  "always(A > 0 implies B > 0 implies C > 0)",
  "always((A > 0 implies B > 0) implies C > 0)",
  "always(A > 0 or B > 0 implies C > 0)",
  "always(A > 0 iff B > 0)",
  "always((A > 0 iff B > 0) iff C > 0)",
  "always(A > 0 implies B > 0 iff C > 0)",
  "always(if A > 0 then B > 0)",
  "always(if A > 0 then B > 0 else C > 0)",
  "always(if A > 0 then (if B > 0 then C > 0) else A > 0)",
  "always(if A > 0 then B > 0 else if B > 0 then C > 0 else A > 0)",
  "always(if (if A > 0 then B > 0) then C > 0)",
  "always((if A > 0 then B > 0) and C > 0)",
  "always(true and not false)",
  "until(A > 0, B > 0)",
  "weak_until(A > 0, B > 0)",
  "until(A > 0 and B > 0, C > 0)",
  "until(A > 0, B > 0 or C > 0)",
  "until(not A > 0, B > 0)",
  "weak_until(A > 0 implies B > 0, C > 0 and A > 0)",
  // Beyond the base: nesting, windows, now, holes.
  "always(count(Down) >= 1 implies eventually(count(Up) >= 1))",
  "eventually(always(A > 0))",
  "always(always(A > 0))",
  "always[0, 30](A > 0)",
  "eventually[5, 10.5](A > 0)",
  "until[0, 30](A > 0, B > 0)",
  "weak_until[1, 2](A > 0, eventually[0, 3](B > 0))",
  "always(A > 0 implies until(B > 0, C > 0))",
  "always(until(A > 0, B > 0) or not eventually(C > 0))",
  "until(eventually(A > 0), always(B > 0))",
  "count(Queue) <= 5",
  "always(A > 0) and eventually(B > 0)",
  "not always(A > 0)",
  "if A > 0 then eventually(B > 0) else C > 0",
  "always(_)",
  "until(Waiting > 0, _)",
  "eventually(A > 0 and (_ or B > 0))",
  "_",
  // A prefix operator inside a larger expression, and an until inside another operator.
  "always(A > 0) or B > 0",
  "always(A > 0) and eventually(B > 0) and C > 0",
  "A > 0 implies always(B > 0) or C > 0",
  "(always(A > 0) or B > 0) implies C > 0",
  "always(A > 0) iff eventually(B > 0)",
  "if always(A > 0) then B > 0 else eventually(C > 0)",
  "not eventually[0, 3](A > 0) and B > 0",
  "always(A > 0 implies (until(B > 0, C > 0) or A > 0))",
  "until(always(A > 0), until(B > 0, C > 0))",
  "until[0, 30](always(A > 0), B > 0)",
  "weak_until(not A > 0, not not B > 0)",
  "weak_until(if A > 0 then B > 0, C > 0)",
  "until(_, true)",
  "eventually[0, 5](always[1, 2](_))",
];

/** Inputs in every accepted style, each with its canonical word-style print. */
const WORD_STYLE_CASES = [
  ["always(Waiting <= 5)", "always (Waiting <= 5)"],
  ["eventually(fired(Restock) >= 1)", "eventually (fired(Restock) >= 1)"],
  ["until(count(Stock) > 0, fired(Restock) >= 1)", "count(Stock) > 0 until fired(Restock) >= 1"],
  ["until(A > 0 and B > 0, C > 0)", "(A > 0 and B > 0) until C > 0"],
  ["weak_until(A > 0, B > 0)", "A > 0 weak until B > 0"],
  ["eventually[0, 30](count(Done) >= 1)", "eventually [0, 30] (count(Done) >= 1)"],
  ["until[0, 30](A > 0, B > 0)", "(A > 0) until [0, 30] (B > 0)"],
  ["weak_until[1, 2](A > 0, B > 0)", "(A > 0) weak until [1, 2] (B > 0)"],
  [
    "always(count(Down) >= 1 implies eventually(count(Up) >= 1))",
    "always (count(Down) >= 1 implies eventually (count(Up) >= 1))",
  ],
  ["always(A > 0) or B > 0", "(always (A > 0)) or B > 0"],
  ["A > 0 or always(B > 0)", "A > 0 or always (B > 0)"],
  ["always(A > 0 or B > 0)", "always (A > 0 or B > 0)"],
  ["always(A > 0) and eventually(B > 0)", "(always (A > 0)) and eventually (B > 0)"],
  ["not always(A > 0)", "not always (A > 0)"],
  ["always(A > 0 implies (until(B > 0, C > 0) or A > 0))", "always (A > 0 implies (B > 0 until C > 0) or A > 0)"],
  ["until(always(A > 0), B > 0)", "(always (A > 0)) until B > 0"],
  ["until(not A > 0, B > 0)", "not A > 0 until B > 0"],
  ["count(Queue) <= 5", "count(Queue) <= 5"],
  ["_", "_"],
  ["always(_)", "always (_)"],
  ["until(Waiting > 0, _)", "Waiting > 0 until _"],
];

/** The old word style the parser still reads, each with its canonical print. */
const OLD_STYLE_CASES = [
  ["always Waiting <= 5", "always (Waiting <= 5)"],
  ["always (A > 0 and B > 0) ", "always (A > 0 and B > 0)"],
  ["A > 0 until B > 0", "A > 0 until B > 0"],
  ["A > 0 weak until B > 0", "A > 0 weak until B > 0"],
  ["(A > 0 and B > 0) until C > 0", "(A > 0 and B > 0) until C > 0"],
  ["not A > 0 until B > 0", "not A > 0 until B > 0"],
];

describe("printConstraint", () => {
  it.each(ROUND_TRIP_CASES)("round-trips %s", (text) => {
    // GIVEN a parsed constraint
    const ast = parsed(text);

    // WHEN it is printed and parsed again
    const printed = printConstraint(ast);
    const reparsed = parsed(printed);

    // THEN the AST is the same, the print reads back with no warning, and printing again changes nothing
    expect(reparsed).toEqual(ast);
    expect(parseConstraint(printed, { mtl: true, nested: true }).diagnostics).toEqual([]);
    expect(printConstraint(reparsed)).toBe(printed);
  });

  it.each(WORD_STYLE_CASES)("prints %s in word style as %s", (text, canonical) => {
    // GIVEN a constraint written in any accepted style
    const ast = parsed(text);

    // WHEN it is printed
    const printed = printConstraint(ast);

    // THEN it is word style, and reads back to the same AST
    expect(printed).toBe(canonical);
    expect(parsed(printed)).toEqual(ast);
  });

  it.each(OLD_STYLE_CASES)("prints the old style %s in word style", (text, canonical) => {
    // GIVEN a constraint in the old word style
    const ast = parsed(text);

    // WHEN it is printed
    const printed = printConstraint(ast);

    // THEN it is function style, and reads back to the same AST
    expect(printed).toBe(canonical);
    expect(parsed(printed)).toEqual(ast);
  });

  it("prints words and ASCII comparators for aliases", () => {
    // GIVEN a constraint written with the symbol aliases
    const ast = parsed("always A ≤ 1 -> B ≥ 2 <-> C ≠ 3");

    // WHEN it is printed
    const text = printConstraint(ast);

    // THEN it uses the words and ASCII
    expect(text).toBe("always (A <= 1 implies B >= 2 iff C != 3)");
  });

  it("adds brackets whenever and/or mix", () => {
    // GIVEN an unbracketed mix, which parses by precedence
    const ast = parsed("always A > 0 or B > 0 and C > 0");

    // WHEN it is printed
    const text = printConstraint(ast);

    // THEN the and is bracketed
    expect(text).toBe("always (A > 0 or (B > 0 and C > 0))");
  });

  it("uses minimal brackets for plain chains", () => {
    // GIVEN a chain of and with a not, every operand bracketed
    const ast = parsed("always((A > 0) and (not B > 0) and (C > 0))");

    // WHEN it is printed
    const text = printConstraint(ast);

    // THEN no brackets remain inside the temporal operator
    expect(text).toBe("always (A > 0 and not B > 0 and C > 0)");
  });
});

describe("printMath", () => {
  it.each([
    ["always(Waiting <= 5)", "G (Waiting ≤ 5)"],
    ["eventually[0, 30](count(Done) >= 1)", "F[0,30] (count(Done) ≥ 1)"],
    ["until(A > 0, B == 1)", "(A > 0) U (B = 1)"],
    ["weak_until[1, 2](A != 0, B > 0)", "(A ≠ 0) W[1,2] (B > 0)"],
    ["always(count(Down) >= 1 implies eventually(count(Up) >= 1))", "G (count(Down) ≥ 1 → F (count(Up) ≥ 1))"],
    ["always(not A > 0 or B > 0 and C > 0)", "G (¬(A > 0) ∨ (B > 0 ∧ C > 0))"],
    ["always(A > 0 iff B > 0)", "G (A > 0 ↔ B > 0)"],
    ["always(if A > 0 then B > 0 else C > 0)", "G ((A > 0 → B > 0) ∧ (¬(A > 0) → C > 0))"],
    ["always(if A > 0 then B > 0)", "G (A > 0 → B > 0)"],
    ["count(Queue) <= 5", "count(Queue) ≤ 5"],
    ["until(Waiting > 0, _)", "(Waiting > 0) U □"],
    ["eventually(always(A > 0))", "F G (A > 0)"],
    ["always(A > 0 and until(B > 0, C > 0))", "G (A > 0 ∧ ((B > 0) U (C > 0)))"],
  ])("prints %s as %s", (text, math) => {
    // GIVEN a constraint
    const ast = parsed(text);

    // WHEN it is printed in math notation
    const printed = printMath(ast);

    // THEN it uses G, F, U, W and the math symbols
    expect(printed).toBe(math);
  });

  it.each(ROUND_TRIP_CASES.filter((text) => !text.includes("if ")))("round-trips %s through math", (text) => {
    // GIVEN a parsed constraint with no if/then/else
    const ast = parsed(text);

    // WHEN it is printed in math and parsed again
    const reparsed = parseConstraint(printMath(ast), { mtl: true, nested: true });

    // THEN the AST is the same, with no warning
    expect(reparsed).toEqual({ constraint: ast, diagnostics: [] });
  });

  it.each(ROUND_TRIP_CASES.filter((text) => text.includes("if ")))(
    "keeps the meaning of %s through math, where if/then/else prints as its expansion",
    (text) => {
      // GIVEN a constraint with if/then/else, and every assignment of its atoms over a short run
      const ast = parsed(text);
      const expanded = parsed(printMath(ast));
      const states = assignments();

      // WHEN both are evaluated at every state
      const truthOf = (constraint: Constraint) =>
        states.map((state) => evaluate(docOf({ op: "now", body: formulaBody(constraint) }), [state]).finalVerdict);

      // THEN the expansion agrees with the original everywhere
      expect(truthOf(expanded)).toEqual(truthOf(ast));
    },
  );
});

/** Every assignment of the metrics A, B, C to 0 or 1, as one-state runs. */
function assignments(): RunState[] {
  const states: RunState[] = [];
  for (let bits = 0; bits < 8; bits += 1) {
    states.push({
      step: 0,
      time: 0,
      marking: { P: bits & 1, Q: (bits >> 1) & 1, R: (bits >> 2) & 1 },
      fired: {},
    });
  }
  return states;
}

function docOf(constraint: Constraint) {
  return {
    name: "test",
    metrics: [
      { name: "A", expr: parseMetricExpr("count(P)").expr! },
      { name: "B", expr: parseMetricExpr("count(Q)").expr! },
      { name: "C", expr: parseMetricExpr("count(R)").expr! },
    ],
    constraint,
    run: { seed: 1, maxSteps: 0 },
  };
}

/** The formula of a constraint, so a one-state run reads it at s0. */
function formulaBody(constraint: Constraint): StateExpr {
  if (constraint.op === "now") {
    return constraint.body;
  }
  if (constraint.op === "always" || constraint.op === "eventually") {
    return { kind: constraint.op, body: constraint.body };
  }
  return { kind: constraint.op, hold: constraint.hold, goal: constraint.goal };
}

describe("printMetricExpr", () => {
  it.each([
    "count(Queue) + fired(Serve) * 2",
    "(count(A) + count(B)) * 2",
    "Served / (Served + 1)",
    "10 - (3 - 2)",
    "10 - 3 - 2",
    "-(A + B)",
    "A * -B",
  ])("round-trips %s", (text) => {
    // GIVEN a parsed metric expression
    const expr = parseMetricExpr(text).expr!;

    // WHEN it is printed and parsed again
    const reparsed = parseMetricExpr(printMetricExpr(expr)).expr;

    // THEN the AST is the same
    expect(reparsed).toEqual(expr);
  });

  it("drops redundant brackets", () => {
    // GIVEN a sum inside a sum on the left
    const expr = parseMetricExpr("((A + B)) + C").expr!;

    // WHEN it is printed
    const text = printMetricExpr(expr);

    // THEN no brackets remain
    expect(text).toBe("A + B + C");
  });
});
