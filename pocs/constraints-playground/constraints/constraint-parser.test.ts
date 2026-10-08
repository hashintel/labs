import { describe, expect, it } from "vitest";

import {
  CHAINED_IFF_ERROR,
  CHAINED_UNTIL_ERROR,
  MIXED_WARNING,
  NO_TEMPORAL_ERROR,
  UNTIL_WARNING,
  parseConstraint,
} from "./constraint-parser";

import type { StateExpr } from "./ast";

const A: StateExpr = { kind: "atom", ref: { kind: "metric", name: "A" }, op: ">", value: 0 };
const B: StateExpr = { kind: "atom", ref: { kind: "metric", name: "B" }, op: ">", value: 0 };
const C: StateExpr = { kind: "atom", ref: { kind: "metric", name: "C" }, op: ">", value: 0 };

function body(text: string): StateExpr {
  const { constraint, diagnostics } = parseConstraint(`always(${text})`);
  if (constraint?.op !== "always") {
    throw new Error(`did not parse: ${JSON.stringify(diagnostics)}`);
  }
  return constraint.body;
}

/** Nested operators on, for the tests of what nests. */
const NESTED = { nested: true };

describe("parseConstraint: operators", () => {
  it("reads always and eventually", () => {
    // GIVEN one atom under each operator
    // WHEN they are parsed
    const always = parseConstraint("always Waiting <= 5");
    const eventually = parseConstraint("eventually count(Done) >= 1");

    // THEN each has the operator and the atom
    expect(always.constraint).toEqual({
      op: "always",
      body: { kind: "atom", ref: { kind: "metric", name: "Waiting" }, op: "<=", value: 5 },
    });
    expect(eventually.constraint).toEqual({
      op: "eventually",
      body: { kind: "atom", ref: { kind: "count", place: "Done" }, op: ">=", value: 1 },
    });
  });

  it("reads until and weak until with their sides", () => {
    // GIVEN both until forms
    // WHEN they are parsed
    const until = parseConstraint("A > 0 until B > 0");
    const weak = parseConstraint("A > 0 weak until B > 0");

    // THEN hold and goal are the two sides
    expect(until.constraint).toEqual({ op: "until", hold: A, goal: B });
    expect(weak.constraint).toEqual({ op: "weak-until", hold: A, goal: B });
  });

  it("reads brackets around a multi-atom side", () => {
    // GIVEN a bracketed hold side
    // WHEN it is parsed
    const { constraint } = parseConstraint("(A > 0 and B > 0) until C > 0");

    // THEN the hold side is the and
    expect(constraint).toEqual({
      op: "until",
      hold: { kind: "and", operands: [A, B] },
      goal: C,
    });
  });

  it("reads fired and a negative bound", () => {
    // GIVEN an inline fired atom with a negative number
    // WHEN it is parsed
    const { constraint } = parseConstraint("always fired(Go) > -1");

    // THEN the bound is minus one
    expect(constraint).toMatchObject({ body: { ref: { kind: "fired", transition: "Go" }, value: -1 } });
  });
});

describe("parseConstraint: comparators and aliases", () => {
  it.each([
    ["<", "<"],
    ["<=", "<="],
    [">", ">"],
    [">=", ">="],
    ["==", "=="],
    ["!=", "!="],
    ["≤", "<="],
    ["≥", ">="],
    ["≠", "!="],
  ])("reads %s as %s", (written, expected) => {
    // GIVEN an atom written with one comparator
    // WHEN it is parsed
    const expr = body(`A ${written} 1`);

    // THEN the AST holds the ASCII comparator
    expect(expr).toMatchObject({ kind: "atom", op: expected });
  });

  it("reads -> as implies and <-> as iff", () => {
    // GIVEN the symbol aliases
    // WHEN they are parsed
    const implies = body("A > 0 -> B > 0");
    const iff = body("A > 0 <-> B > 0");

    // THEN they equal the word forms
    expect(implies).toEqual(body("A > 0 implies B > 0"));
    expect(iff).toEqual(body("A > 0 iff B > 0"));
  });
});

describe("parseConstraint: precedence", () => {
  it("binds and tighter than or", () => {
    // GIVEN A or B and C
    // WHEN it is parsed
    const expr = body("A > 0 or B > 0 and C > 0");

    // THEN B and C group first
    expect(expr).toEqual({ kind: "or", operands: [A, { kind: "and", operands: [B, C] }] });
  });

  it("binds not tighter than and", () => {
    // GIVEN not A and B
    // WHEN it is parsed
    const expr = body("not A > 0 and B > 0");

    // THEN the not covers A only
    expect(expr).toEqual({ kind: "and", operands: [{ kind: "not", operand: A }, B] });
  });

  it("binds or tighter than implies and implies tighter than iff", () => {
    // GIVEN A or B implies C iff A
    // WHEN it is parsed
    const expr = body("A > 0 or B > 0 implies C > 0 iff A > 0");

    // THEN iff is the root, implies the left, or inside
    expect(expr).toEqual({
      kind: "iff",
      left: { kind: "implies", left: { kind: "or", operands: [A, B] }, right: C },
      right: A,
    });
  });

  it("makes implies right-associative", () => {
    // GIVEN A implies B implies C
    // WHEN it is parsed
    const expr = body("A > 0 implies B > 0 implies C > 0");

    // THEN it reads A implies (B implies C)
    expect(expr).toEqual({
      kind: "implies",
      left: A,
      right: { kind: "implies", left: B, right: C },
    });
  });

  it("flattens a chain of and", () => {
    // GIVEN three atoms joined by and
    // WHEN it is parsed
    const expr = body("A > 0 and B > 0 and C > 0");

    // THEN one and holds all three
    expect(expr).toEqual({ kind: "and", operands: [A, B, C] });
  });

  it("lets brackets override precedence", () => {
    // GIVEN (A or B) and C
    // WHEN it is parsed
    const expr = body("(A > 0 or B > 0) and C > 0");

    // THEN the or is the first operand
    expect(expr).toEqual({ kind: "and", operands: [{ kind: "or", operands: [A, B] }, C] });
  });

  it("reads true and false", () => {
    // GIVEN the two constants
    // WHEN they are parsed
    const expr = body("true and not false");

    // THEN they are bool nodes
    expect(expr).toEqual({
      kind: "and",
      operands: [
        { kind: "bool", value: true },
        { kind: "not", operand: { kind: "bool", value: false } },
      ],
    });
  });

  it("reads if then with and without else", () => {
    // GIVEN both forms
    // WHEN they are parsed
    const plain = body("if A > 0 then B > 0");
    const full = body("if A > 0 then B > 0 else C > 0");

    // THEN else is present only in the second
    expect(plain).toEqual({ kind: "ite", cond: A, then: B });
    expect(full).toEqual({ kind: "ite", cond: A, then: B, else: C });
  });

  it("lets a branch take the rest of the expression", () => {
    // GIVEN a then branch with an or
    // WHEN it is parsed
    const expr = body("if A > 0 then B > 0 or C > 0 else A > 0");

    // THEN the or is inside the branch
    expect(expr).toEqual({
      kind: "ite",
      cond: A,
      then: { kind: "or", operands: [B, C] },
      else: A,
    });
  });
});

describe("parseConstraint: warnings", () => {
  it("warns on mixed and/or without brackets", () => {
    // GIVEN A or B and C
    // WHEN it is parsed
    const result = parseConstraint("always A > 0 or B > 0 and C > 0");

    // THEN it still parses, with one warning at the and chain
    expect(result.constraint).toBeDefined();
    expect(result.diagnostics).toEqual([
      { severity: "warning", message: MIXED_WARNING, column: 17 },
    ]);
  });

  it("warns when and comes first", () => {
    // GIVEN A and B or C
    // WHEN it is parsed
    const result = parseConstraint("always A > 0 and B > 0 or C > 0");

    // THEN there is one warning at A
    expect(result.diagnostics).toEqual([
      { severity: "warning", message: MIXED_WARNING, column: 8 },
    ]);
  });

  it("does not warn when brackets show the grouping", () => {
    // GIVEN both bracketed forms and plain chains
    // WHEN they are parsed
    const results = [
      "always((A > 0 and B > 0) or C > 0)",
      "always A > 0 and (B > 0 or C > 0)",
      "always A > 0 and B > 0 and C > 0",
      "always A > 0 or B > 0 or C > 0",
    ].map((text) => parseConstraint(text));

    // THEN there are no diagnostics
    expect(results.map((result) => result.diagnostics)).toEqual([[], [], [], []]);
  });
});

describe("parseConstraint: errors", () => {
  it("reads a temporal operator inside another", () => {
    // GIVEN always inside always, in function style and in the old word style
    // WHEN they are parsed
    const nested = parseConstraint("always(always(A > 0))", NESTED);
    const words = parseConstraint("always (always A > 0)", NESTED);

    // THEN both give always around always, with no diagnostic
    const expected = { op: "always", body: { kind: "always", body: A } };
    expect(nested).toEqual({ constraint: expected, diagnostics: [] });
    expect(words).toEqual({ constraint: expected, diagnostics: [] });
  });

  it("reads eventually inside a side of until", () => {
    // GIVEN eventually on the goal side of a word-style until
    // WHEN it is parsed
    const { constraint, diagnostics } = parseConstraint("A > 0 until eventually B > 0", NESTED);

    // THEN the goal is the eventually
    expect(constraint).toEqual({ op: "until", hold: A, goal: { kind: "eventually", body: B } });
    expect(diagnostics).toEqual([]);
  });

  it("rejects a chain of infix until", () => {
    // GIVEN two infix untils
    // WHEN it is parsed
    const { diagnostics } = parseConstraint("A > 0 until B > 0 until C > 0");

    // THEN the second is the error, which asks for brackets
    expect(diagnostics).toEqual([{ severity: "error", message: CHAINED_UNTIL_ERROR, column: 19 }]);
  });

  it("lets a word-style always take everything to its right, until included", () => {
    // GIVEN always A until B in the old word style
    // WHEN it is parsed
    const { constraint } = parseConstraint("always A > 0 until B > 0", NESTED);

    // THEN always covers the until
    expect(constraint).toEqual({ op: "always", body: { kind: "until", hold: A, goal: B } });
  });

  it("reads a formula with no temporal operator as now", () => {
    // GIVEN a bare state constraint
    // WHEN it is parsed
    const { constraint, diagnostics } = parseConstraint("Waiting <= 5");

    // THEN it is a now constraint, with no diagnostic
    expect(constraint).toEqual({
      op: "now",
      body: { kind: "atom", ref: { kind: "metric", name: "Waiting" }, op: "<=", value: 5 },
    });
    expect(diagnostics).toEqual([]);
  });

  it("rejects empty text", () => {
    // GIVEN nothing
    // WHEN it is parsed
    const { diagnostics } = parseConstraint("   ");

    // THEN it asks for a temporal operator
    expect(diagnostics[0]?.message).toBe(NO_TEMPORAL_ERROR);
  });

  it("rejects arithmetic in an atom", () => {
    // GIVEN a sum on the left of a comparator
    // WHEN it is parsed
    const { diagnostics } = parseConstraint("always count(A) + count(B) > 3");

    // THEN the error says to define a metric, at the plus
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: "Arithmetic is not allowed in a constraint. Define a metric for it",
        column: 17,
      },
    ]);
  });

  it("rejects a missing comparator", () => {
    // GIVEN a metric alone
    // WHEN it is parsed
    const { diagnostics } = parseConstraint("always Waiting");

    // THEN the error lists the comparators
    expect(diagnostics[0]?.message).toContain("Expected a comparator");
    expect(diagnostics[0]?.column).toBe(15);
  });

  it("rejects a non-number bound", () => {
    // GIVEN a metric on the right side
    // WHEN it is parsed
    const { diagnostics } = parseConstraint("always A > B");

    // THEN the error asks for a number
    expect(diagnostics[0]?.message).toBe('Expected a number but found "B"');
  });

  it("reads a single equals sign as ==", () => {
    // GIVEN = instead of ==, as math notation writes it
    // WHEN both are parsed
    const single = parseConstraint("always A = 1");
    const double = parseConstraint("always A == 1");

    // THEN they give the same constraint
    expect(single).toEqual(double);
  });

  it("rejects an unclosed bracket", () => {
    // GIVEN a missing closing bracket
    // WHEN it is parsed
    const { diagnostics } = parseConstraint("always (A > 0");

    // THEN the error is at the end
    expect(diagnostics).toEqual([
      { severity: "error", message: 'Expected ")" but found the end of the text', column: 14 },
    ]);
  });

  it("rejects an if without then", () => {
    // GIVEN if with no then
    // WHEN it is parsed
    const { diagnostics } = parseConstraint("always if A > 0");

    // THEN the error names then
    expect(diagnostics[0]?.message).toBe('Expected "then" but found the end of the text');
  });

  it("rejects an if inside another expression", () => {
    // GIVEN an if as an and operand
    // WHEN it is parsed
    const { diagnostics } = parseConstraint("always A > 0 and if B > 0 then C > 0");

    // THEN the error asks for brackets
    expect(diagnostics[0]?.message).toContain("in brackets");
  });

  it("rejects chained iff", () => {
    // GIVEN A iff B iff C
    // WHEN it is parsed
    const { diagnostics } = parseConstraint("always A > 0 iff B > 0 iff C > 0");

    // THEN the error asks for brackets
    expect(diagnostics[0]?.message).toBe(CHAINED_IFF_ERROR);
  });

  it("gives the else to the nearest if", () => {
    // GIVEN an if inside the then branch of another, with one else
    // WHEN it is parsed
    const expr = body("if A > 0 then if B > 0 then C > 0 else A > 0");

    // THEN the else belongs to the inner if
    expect(expr).toEqual({
      kind: "ite",
      cond: A,
      then: { kind: "ite", cond: B, then: C, else: A },
    });
  });

  it("reads decimals and negatives in an atom", () => {
    // GIVEN atoms with a decimal and a negative decimal
    // WHEN they are parsed
    const decimal = body("A >= 0.5");
    const negative = body("A > -2.25");

    // THEN the values are kept
    expect(decimal).toMatchObject({ value: 0.5 });
    expect(negative).toMatchObject({ value: -2.25 });
  });

  it("accepts a multi-atom side of until without brackets, with a warning", () => {
    // GIVEN A and B until C, and the same with a bracketed hold side
    // WHEN they are parsed
    const bare = parseConstraint("A > 0 and B > 0 until C > 0");
    const wrapped = parseConstraint("(A > 0 and B > 0) until C > 0");
    const apart = parseConstraint("(A > 0) and (B > 0) until C > 0");

    // THEN the bare form reads as (A and B) until C and warns, the bracketed form is quiet
    expect(bare.constraint).toEqual(wrapped.constraint);
    expect(bare.diagnostics).toEqual([{ severity: "warning", message: UNTIL_WARNING, column: 1 }]);
    expect(wrapped.diagnostics).toEqual([]);
    expect(apart.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([UNTIL_WARNING]);
  });

  it("warns for the goal side of until too", () => {
    // GIVEN a bare multi-atom goal
    // WHEN it is parsed
    const { constraint, diagnostics } = parseConstraint("A > 0 weak until B > 0 or C > 0");

    // THEN the goal is the or, and the warning points at it
    expect(constraint).toMatchObject({ op: "weak-until", goal: { kind: "or", operands: [B, C] } });
    expect(diagnostics).toEqual([{ severity: "warning", message: UNTIL_WARNING, column: 18 }]);
  });

  it("rejects weak without until", () => {
    // GIVEN weak followed by a state
    // WHEN it is parsed
    const { diagnostics } = parseConstraint("A > 0 weak B > 0");

    // THEN the error expects until
    expect(diagnostics[0]?.message).toBe('Expected "until" but found "B"');
  });
});
