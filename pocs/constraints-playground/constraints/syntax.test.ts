import { describe, expect, it } from "vitest";

import {
  EXISTS_ERROR,
  FORALL_ERROR,
  TEMPORAL_SCOPE_WARNING,
  UNTIL_WARNING,
  WINDOW_NEEDS_MTL_ERROR,
  NESTED_NEEDS_LTL_ERROR,
  parseConstraint,
} from "./constraint-parser";

import type { StateExpr } from "./ast";

const atom = (name: string): StateExpr => ({ kind: "atom", ref: { kind: "metric", name }, op: ">", value: 0 });
const A = atom("A");
const B = atom("B");
const C = atom("C");

function parsedOk(text: string) {
  const result = parseConstraint(text, { mtl: true, nested: true });
  if (result.constraint === undefined) {
    throw new Error(`did not parse "${text}": ${JSON.stringify(result.diagnostics)}`);
  }
  return result;
}

describe("parseConstraint: function style", () => {
  it("reads each operator as a call", () => {
    // GIVEN the four operators in function style
    // WHEN they are parsed
    const always = parsedOk("always(Waiting <= 5)").constraint;
    const eventually = parsedOk("eventually(count(Done) >= 1)").constraint;
    const until = parsedOk("until(A > 0, B > 0)").constraint;
    const weak = parsedOk("weak_until(A > 0, B > 0)").constraint;

    // THEN each has its operator and operands
    expect(always).toMatchObject({ op: "always", body: { kind: "atom", op: "<=", value: 5 } });
    expect(eventually).toMatchObject({ op: "eventually", body: { ref: { kind: "count", place: "Done" } } });
    expect(until).toEqual({ op: "until", hold: A, goal: B });
    expect(weak).toEqual({ op: "weak-until", hold: A, goal: B });
  });

  it("reads windows on each operator", () => {
    // GIVEN windowed operators, one with a decimal end
    // WHEN they are parsed
    const always = parsedOk("always[0, 30](A > 0)").constraint;
    const eventually = parsedOk("eventually[5, 10.5](A > 0)").constraint;
    const until = parsedOk("until[0, 30](A > 0, B > 0)").constraint;

    // THEN the window sits on the operator, both ends kept
    expect(always).toEqual({ op: "always", body: A, window: { from: 0, to: 30 } });
    expect(eventually).toEqual({ op: "eventually", body: A, window: { from: 5, to: 10.5 } });
    expect(until).toEqual({ op: "until", hold: A, goal: B, window: { from: 0, to: 30 } });
  });

  it("reads the nested response rule", () => {
    // GIVEN always (Down implies eventually Up)
    // WHEN it is parsed
    const { constraint, diagnostics } = parsedOk("always(count(Down) >= 1 implies eventually(count(Up) >= 1))");

    // THEN eventually sits on the right of implies, inside always
    expect(constraint).toEqual({
      op: "always",
      body: {
        kind: "implies",
        left: { kind: "atom", ref: { kind: "count", place: "Down" }, op: ">=", value: 1 },
        right: {
          kind: "eventually",
          body: { kind: "atom", ref: { kind: "count", place: "Up" }, op: ">=", value: 1 },
        },
      },
    });
    expect(diagnostics).toEqual([]);
  });

  it("reads temporal calls joined by logic as now", () => {
    // GIVEN two calls joined by and
    // WHEN it is parsed
    const { constraint, diagnostics } = parsedOk("always(A > 0) and eventually(B > 0)");

    // THEN the top is now, the and holds both calls, and there is no warning
    expect(constraint).toEqual({
      op: "now",
      body: { kind: "and", operands: [{ kind: "always", body: A }, { kind: "eventually", body: B }] },
    });
    expect(diagnostics).toEqual([]);
  });

  it("warns when an old-style always in brackets is followed by more", () => {
    // GIVEN always (A) or B, written with a space as the old word style did
    // WHEN it is parsed
    const { constraint, diagnostics } = parsedOk("always (A > 0) or B > 0");

    // THEN always covers its brackets only, and a warning says so at the keyword
    expect(constraint).toEqual({ op: "now", body: { kind: "or", operands: [{ kind: "always", body: A }, B] } });
    expect(diagnostics).toEqual([{ severity: "warning", message: TEMPORAL_SCOPE_WARNING, column: 1 }]);
  });

  it("reads a window on a call nested inside", () => {
    // GIVEN a windowed until inside always
    // WHEN it is parsed
    const { constraint } = parsedOk("always(until[2, 4](A > 0, B > 0) or C > 0)");

    // THEN the inner node carries the window
    expect(constraint).toEqual({
      op: "always",
      body: { kind: "or", operands: [{ kind: "until", hold: A, goal: B, window: { from: 2, to: 4 } }, C] },
    });
  });

  it.each([
    ["always[30, 0](A > 0)", "A window ends at or after its start", 7],
    ["always[-1, 3](A > 0)", "A window starts at 0 or later", 7],
    ["always[0 30](A > 0)", 'Expected "," but found "30"', 10],
    ["until(A > 0)", 'Expected "," but found ")"', 12],
    ["until A > 0", "until takes two sides: until(A, B), or A until B", 7],
    ["eventually_(A > 0)", 'Expected a window such as [0, 30] but found "("', 12],
  ])("rejects %s", (text, message, column) => {
    // GIVEN a malformed window or call
    // WHEN it is parsed
    const { constraint, diagnostics } = parseConstraint(text, { mtl: true, nested: true });

    // THEN there is one error at the column
    expect(constraint).toBeUndefined();
    expect(diagnostics).toEqual([{ severity: "error", message, column }]);
  });
});

describe("parseConstraint: holes", () => {
  it("reads _ as a hole wherever a formula goes, and □ as the same hole", () => {
    // GIVEN holes as a whole body, as an until side, inside logic, and in math
    // WHEN they are parsed
    const whole = parsedOk("always(_)").constraint;
    const side = parsedOk("until(Waiting > 0, _)").constraint;
    const inside = parsedOk("eventually(A > 0 and _)").constraint;
    const box = parsedOk("G □").constraint;

    // THEN each slot is a hole node
    expect(whole).toEqual({ op: "always", body: { kind: "hole" } });
    expect(side).toMatchObject({ op: "until", goal: { kind: "hole" } });
    expect(inside).toEqual({ op: "eventually", body: { kind: "and", operands: [A, { kind: "hole" }] } });
    expect(box).toEqual(whole);
  });
});

describe("parseConstraint: aliases", () => {
  it.each([
    ["always (A > 0)", "always(A > 0)"],
    ["always A > 0 and B > 0", "always(A > 0 and B > 0)"],
    ["A > 0 until B > 0", "until(A > 0, B > 0)"],
    ["A > 0 weak until B > 0", "weak_until(A > 0, B > 0)"],
    ["A > 0 weak_until B > 0", "weak_until(A > 0, B > 0)"],
    ["G A > 0", "always(A > 0)"],
    ["G (A > 0)", "always(A > 0)"],
    ["F (A > 0)", "eventually(A > 0)"],
    ["A > 0 U B > 0", "until(A > 0, B > 0)"],
    ["(A > 0) W (B > 0)", "weak_until(A > 0, B > 0)"],
    ["G[0,30] A > 0", "always[0, 30](A > 0)"],
    ["F_[0,30] (A > 0)", "eventually[0, 30](A > 0)"],
    ["eventually_[0,2] A > 0", "eventually[0, 2](A > 0)"],
    ["A > 0 U[0,30] B > 0", "until[0, 30](A > 0, B > 0)"],
    ["A > 0 U_[1,2] B > 0", "until[1, 2](A > 0, B > 0)"],
    ["G (A > 0 → F (B > 0))", "always(A > 0 implies eventually(B > 0))"],
    ["G (A ≥ 1 ∧ B ≤ 2 ∧ C ≠ 3)", "always(A >= 1 and B <= 2 and C != 3)"],
    ["G (A > 0 ∨ ¬(B > 0))", "always(A > 0 or not B > 0)"],
    ["G (A > 0 ↔ B > 0)", "always(A > 0 iff B > 0)"],
    ["G (A = 1)", "always(A == 1)"],
    ["G ((A > 0 && B > 0) || !(C > 0))", "always((A > 0 and B > 0) or not C > 0)"],
    ["G (A > 0 -> B > 0 <-> C > 0)", "always(A > 0 implies B > 0 iff C > 0)"],
  ])("reads %s as %s", (alias, canonical) => {
    // GIVEN a constraint in an alias syntax, and its canonical form
    // WHEN both are parsed
    const fromAlias = parsedOk(alias).constraint;
    const fromCanonical = parsedOk(canonical).constraint;

    // THEN they give the same AST
    expect(fromAlias).toEqual(fromCanonical);
  });

  it("binds G and F like not, so G A and B reads (G A) and B", () => {
    // GIVEN G followed by an and, without brackets
    // WHEN it is parsed
    const { constraint } = parsedOk("G A > 0 ∧ B > 0");

    // THEN G covers A only and the top is now
    expect(constraint).toEqual({ op: "now", body: { kind: "and", operands: [{ kind: "always", body: A }, B] } });
  });

  it("reads G, F, U and W as metric names where a comparator follows", () => {
    // GIVEN metrics named after the math letters
    // WHEN they are parsed
    const g = parsedOk("G >= 1").constraint;
    const others = parsedOk("always(F > 0 and U > 0 and W > 0)").constraint;

    // THEN they are atoms, not operators
    expect(g).toEqual({ op: "now", body: { kind: "atom", ref: { kind: "metric", name: "G" }, op: ">=", value: 1 } });
    expect(others).toEqual({ op: "always", body: { kind: "and", operands: [atom("F"), atom("U"), atom("W")] } });
  });

  it("reads a math U with unbracketed sides as loosest, with a warning", () => {
    // GIVEN A and B U C: until binds loosest here, unlike some LTL tools
    // WHEN it is parsed
    const { constraint, diagnostics } = parsedOk("A > 0 ∧ B > 0 U C > 0");

    // THEN it reads (A and B) U C, with the warning at A
    expect(constraint).toEqual({ op: "until", hold: { kind: "and", operands: [A, B] }, goal: C });
    expect(diagnostics).toEqual([{ severity: "warning", message: UNTIL_WARNING, column: 1 }]);
  });
});

describe("parseConstraint: quantifiers", () => {
  it.each([
    ["always(forall Waiting > 0)", FORALL_ERROR, 8],
    ["G (∀ Waiting > 0)", FORALL_ERROR, 4],
    ["exists Waiting > 0", EXISTS_ERROR, 1],
    ["∃ Waiting > 0", EXISTS_ERROR, 1],
  ])("rejects %s with a message about coloured tokens at its column", (text, message, column) => {
    // GIVEN a quantifier
    // WHEN it is parsed
    const { constraint, diagnostics } = parseConstraint(text);

    // THEN the error explains why and points at the quantifier
    expect(constraint).toBeUndefined();
    expect(diagnostics).toEqual([{ severity: "error", message, column }]);
    expect(FORALL_ERROR).toBe("for all needs coloured tokens, which the playground does not simulate yet");
  });
});

describe("parseConstraint: the MTL flag", () => {
  it.each([
    ["eventually[0, 30](A > 0)", 11],
    ["always[10, 20](A > 0)", 7],
    ["until[0, 5](A > 0, B > 0)", 6],
    ["A > 0 until[0, 5] B > 0", 12],
    ["F[0,30] A > 0", 2],
    ["G_[0,30] A > 0", 3],
    ["A > 0 U_[1,2] B > 0", 9],
  ])("rejects the window in %s with MTL off, at its column", (text, column) => {
    // GIVEN a windowed constraint, in any alias form
    // WHEN it is parsed with the default options and with mtl false
    const byDefault = parseConstraint(text);
    const off = parseConstraint(text, { mtl: false });

    // THEN both give the one error at the window
    const error = { severity: "error", message: WINDOW_NEEDS_MTL_ERROR, column };
    expect(byDefault.constraint).toBeUndefined();
    expect(byDefault.diagnostics).toEqual([error]);
    expect(off.diagnostics).toEqual([error]);
  });

  it("says what to do in the window error", () => {
    // GIVEN the error text
    // THEN it names MTL and where to turn it on
    expect(WINDOW_NEEDS_MTL_ERROR).toBe("Time windows need MTL. Turn on MTL at the top.");
  });

  it("reads the same windows with MTL on", () => {
    // GIVEN a windowed constraint
    // WHEN it is parsed with mtl true
    const { constraint, diagnostics } = parseConstraint("eventually[0, 30](A > 0)", { mtl: true });

    // THEN it parses with its window and no diagnostic
    expect(diagnostics).toEqual([]);
    expect(constraint).toMatchObject({ op: "eventually", window: { from: 0, to: 30 } });
  });

  it("reads constraints with no window the same with MTL off and on", () => {
    // GIVEN constraints with no window, one with a comparison on a metric named G
    const texts = ["always(A > 0)", "until(A > 0, B > 0)", "G <= 5 and F > 1 implies always(A > 0)"];

    // WHEN each is parsed with mtl off and on
    // THEN the results are equal
    for (const text of texts) {
      expect(parseConstraint(text, { mtl: false, nested: true })).toEqual(parseConstraint(text, { mtl: true, nested: true }));
    }
  });
});

describe("parseConstraint: the nested flag", () => {
  it.each([
    ["always(always(A > 0))", 8],
    ["always(A > 0 implies eventually(B > 0))", 22],
    ["eventually(always(A > 0))", 12],
    ["A > 0 until eventually B > 0", 13],
    ["until(always(A > 0), B > 0)", 7],
    ["always A > 0 until B > 0", 14],
    ["G (A > 0 -> F (B > 0))", 13],
    ["always(A > 0) and eventually(B > 0)", 1],
  ])("rejects the inner operator in %s with nested off, at its column", (text, column) => {
    // GIVEN a constraint with a temporal operator inside another, or inside a condition
    // WHEN it is parsed with the default options and with nested false
    const byDefault = parseConstraint(text);
    const off = parseConstraint(text, { nested: false });

    // THEN both give the one error at the first inner operator
    const error = { severity: "error", message: NESTED_NEEDS_LTL_ERROR, column };
    expect(byDefault.constraint).toBeUndefined();
    expect(byDefault.diagnostics).toEqual([error]);
    expect(off.diagnostics).toEqual([error]);
  });

  it("says what to do in the nested error", () => {
    // GIVEN the error text
    // THEN it names full LTL and where to turn it on
    expect(NESTED_NEEDS_LTL_ERROR).toBe("Nested operators need full LTL. Turn on Nested operators at the top.");
  });

  it("reads the same constraints with nested on", () => {
    // GIVEN a constraint with an operator inside another
    // WHEN it is parsed with nested true
    const { constraint, diagnostics } = parseConstraint("always(A > 0 implies eventually(B > 0))", { nested: true });

    // THEN it parses to always around the implication, with no diagnostic
    expect(diagnostics).toEqual([]);
    expect(constraint).toMatchObject({ op: "always", body: { kind: "implies", right: { kind: "eventually" } } });
  });

  it("keeps the top operator, a window and brackets around it free with nested off", () => {
    // GIVEN constraints with one operator, at the top, in brackets or with a window
    const texts = ["always(A > 0)", "(always(A > 0))", "until(A > 0 and B > 0, C > 0)", "A > 0 until B > 0", "eventually[0, 5](A > 0)"];

    // WHEN each is parsed with nested off and mtl on
    const results = texts.map((text) => parseConstraint(text, { mtl: true, nested: false }));

    // THEN none has a diagnostic
    expect(results.map((result) => result.diagnostics)).toEqual(texts.map(() => []));
  });

  it("asks for nested before MTL only when both are needed and one is off", () => {
    // GIVEN a windowed operator inside another
    const text = "always(A > 0 implies eventually[0, 5](B > 0))";

    // WHEN it is parsed with each flag on alone
    const onlyMtl = parseConstraint(text, { mtl: true });
    const onlyNested = parseConstraint(text, { nested: true });
    const both = parseConstraint(text, { mtl: true, nested: true });

    // THEN each flag alone names the other's error, and both parse
    expect(onlyMtl.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([NESTED_NEEDS_LTL_ERROR]);
    expect(onlyNested.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([WINDOW_NEEDS_MTL_ERROR]);
    expect(both.diagnostics).toEqual([]);
  });
});
