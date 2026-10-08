import { describe, expect, it } from "vitest";

import { parseMetricExpr } from "./metric-parser";
import { printMetricExpr } from "./printer";

describe("parseMetricExpr", () => {
  it("reads count, fired and metric names", () => {
    // GIVEN a sum of the three kinds of reference
    const text = "count(Queue) + fired(Serve) + Served";

    // WHEN it is parsed
    const { expr, diagnostics } = parseMetricExpr(text);

    // THEN it is a left-leaning sum with no diagnostics
    expect(diagnostics).toEqual([]);
    expect(expr).toEqual({
      kind: "binary",
      op: "+",
      left: {
        kind: "binary",
        op: "+",
        left: { kind: "count", place: "Queue" },
        right: { kind: "fired", transition: "Serve" },
      },
      right: { kind: "metric", name: "Served" },
    });
  });

  it("binds multiplication tighter than addition and brackets override it", () => {
    // GIVEN two spellings of the same numbers
    // WHEN both are parsed
    const loose = parseMetricExpr("1 + 2 * 3").expr;
    const bracketed = parseMetricExpr("(1 + 2) * 3").expr;

    // THEN the first multiplies first and the second adds first
    expect(loose).toMatchObject({ op: "+", right: { op: "*" } });
    expect(bracketed).toMatchObject({ op: "*", left: { op: "+" } });
  });

  it("subtracts and divides to the left", () => {
    // GIVEN a chain of subtractions and one of divisions
    // WHEN they are parsed
    const minus = parseMetricExpr("10 - 3 - 2").expr;
    const divide = parseMetricExpr("8 / 4 / 2").expr;

    // THEN each groups on the left
    expect(minus).toMatchObject({ op: "-", left: { op: "-" }, right: { value: 2 } });
    expect(divide).toMatchObject({ op: "/", left: { op: "/" }, right: { value: 2 } });
  });

  it("reads a unary minus", () => {
    // GIVEN a negated place count
    // WHEN it is parsed
    const { expr } = parseMetricExpr("-count(A) * 2");

    // THEN the minus binds to the factor
    expect(expr).toMatchObject({ op: "*", left: { kind: "negate" } });
  });

  it("reads a division of metrics", () => {
    // GIVEN the spec's ratio metric
    // WHEN it is parsed
    const { expr, diagnostics } = parseMetricExpr("Served / (Served + 1)");

    // THEN it parses cleanly
    expect(diagnostics).toEqual([]);
    expect(printMetricExpr(expr!)).toBe("Served / (Served + 1)");
  });

  it("reports a missing bracket with its column", () => {
    // GIVEN an unclosed bracket
    // WHEN it is parsed
    const { expr, diagnostics } = parseMetricExpr("(count(A) + 1");

    // THEN there is one error at the end of the text
    expect(expr).toBeUndefined();
    expect(diagnostics).toEqual([
      { severity: "error", message: 'Expected ")" but found the end of the text', column: 14 },
    ]);
  });

  it("reports a stray word at its column", () => {
    // GIVEN two metrics side by side
    // WHEN they are parsed
    const { diagnostics } = parseMetricExpr("A B");

    // THEN the second is unexpected
    expect(diagnostics).toEqual([{ severity: "error", message: 'Unexpected "B"', column: 3 }]);
  });

  it("reports a lowercase word that is not count or fired", () => {
    // GIVEN a lowercase name
    // WHEN it is parsed
    const { diagnostics } = parseMetricExpr("size + 1");

    // THEN the error says metric names start with a capital
    expect(diagnostics[0]).toMatchObject({ column: 1 });
    expect(diagnostics[0]?.message).toContain("capital");
  });

  it("reports a bad character", () => {
    // GIVEN a character outside the grammar
    // WHEN it is parsed
    const { diagnostics } = parseMetricExpr("1 + $");

    // THEN the error is at the character
    expect(diagnostics).toEqual([
      { severity: "error", message: 'Unexpected character "$"', column: 5 },
    ]);
  });

  it("reports an empty expression", () => {
    // GIVEN empty text
    // WHEN it is parsed
    const { diagnostics } = parseMetricExpr("");

    // THEN an error is reported
    expect(diagnostics).toHaveLength(1);
  });

  it("reports count without a place", () => {
    // GIVEN count with an empty bracket
    // WHEN it is parsed
    const { diagnostics } = parseMetricExpr("count()");

    // THEN the error names what is missing
    expect(diagnostics[0]?.message).toContain("name of a place");
  });
});
