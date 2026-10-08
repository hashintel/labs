import { describe, expect, it } from "vitest";

import { parseMetricExpr } from "../../constraints";
import { metricDefinitions, withConstraintLine, withMathFormula } from "./constraint-text";

describe("withConstraintLine", () => {
  it("replaces the constraint line and leaves the rest as it is", () => {
    // GIVEN a file with a constraint between other entries
    const text = "name: A\nconstraint: always (X <= 5)\nrun:\n  seed: 1\n";
    // WHEN a printed constraint replaces it
    const next = withConstraintLine(text, "eventually (X > 1)");
    // THEN only that line changed
    expect(next).toBe("name: A\nconstraint: eventually (X > 1)\nrun:\n  seed: 1\n");
  });

  it("takes the continuation lines of a block scalar with it", () => {
    // GIVEN a constraint written as a block scalar
    const text = "constraint: >\n  always\n  (X <= 5)\nrun:\n  seed: 1\n";
    // WHEN a printed constraint replaces it
    const next = withConstraintLine(text, "always (X <= 6)");
    // THEN the block is gone and the next entry stays
    expect(next).toBe("constraint: always (X <= 6)\nrun:\n  seed: 1\n");
  });

  it("quotes a constraint a plain scalar would misread", () => {
    // GIVEN a printed constraint holding a colon and a space
    // WHEN it replaces the line
    const next = withConstraintLine("constraint: always true\n", "always (a: b)");
    // THEN the value is a quoted string
    expect(next).toBe('constraint: "always (a: b)"\n');
  });

  it("appends a constraint line to a file with none", () => {
    // GIVEN a file with no constraint entry
    // WHEN a printed constraint is written into it
    const next = withConstraintLine("name: A", "always true");
    // THEN the entry follows the text
    expect(next).toBe("name: A\nconstraint: always true\n");
  });

  it("writes a function-style constraint with a window as a plain scalar", () => {
    // GIVEN a printed constraint with a window and a hole
    const text = "constraint: always true\nrun:\n";
    // WHEN it replaces the line
    const next = withConstraintLine(text, "eventually[0, 30](Waiting <= 5 and _)");
    // THEN the value is not quoted and the next entry stays
    expect(next).toBe("constraint: eventually[0, 30](Waiting <= 5 and _)\nrun:\n");
  });
});

describe("withMathFormula", () => {
  const text = "name: A\nconstraint: always(X <= 5)\nrun:\n  seed: 1\n";

  it("writes a formula in math notation as the word-style constraint line", () => {
    // GIVEN a file and a formula typed in math notation
    // WHEN the formula is written into the file
    const result = withMathFormula(text, "F[0,30] (X ≥ 2 ∧ ¬(X = 4))", { mtl: true });
    // THEN the constraint line holds it in function style and the rest stays
    expect(result.parses).toBe(true);
    expect(result.text).toBe("name: A\nconstraint: eventually [0, 30] (X >= 2 and not X == 4)\nrun:\n  seed: 1\n");
  });

  it("keeps the file and reports the error while the formula does not parse", () => {
    // GIVEN a half-typed formula
    // WHEN it is written into the file
    const result = withMathFormula(text, "G (X ≤", { mtl: false });
    // THEN the file is as it was and there is an error to show
    expect(result.parses).toBe(false);
    expect(result.text).toBe(text);
    expect(result.diagnostics[0]?.severity).toBe("error");
  });
});

describe("metricDefinitions", () => {
  it("writes one Name := expression line per metric", () => {
    // GIVEN two metrics
    const metrics = [
      { name: "Waiting", expr: parseMetricExpr("count(Queue)").expr! },
      { name: "Load", expr: parseMetricExpr("Waiting + 1").expr! },
    ];
    // WHEN they are written
    // THEN each gets a line
    expect(metricDefinitions(metrics)).toBe("Waiting := count(Queue)\nLoad := Waiting + 1");
  });
});
