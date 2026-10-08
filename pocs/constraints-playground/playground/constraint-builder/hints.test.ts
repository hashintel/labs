import { describe, expect, it } from "vitest";

import { HINT_STEPS, OPERATOR_HINTS, WORD_HINTS } from "./hints";

describe("OPERATOR_HINTS", () => {
  it("draws six cells in every row of every operator", () => {
    // GIVEN the hints of the four operators
    // WHEN counting the cells of each row
    const counts = Object.values(OPERATOR_HINTS).flatMap((hint) => hint.rows?.map((row) => row.cells.length) ?? []);
    // THEN every row has six
    expect(counts).toHaveLength(6);
    expect(counts.every((count) => count === HINT_STEPS)).toBe(true);
  });

  it("breaks ALWAYS at step 4 and meets EVENTUALLY at step 3", () => {
    // GIVEN the hints of ALWAYS and EVENTUALLY
    const always = OPERATOR_HINTS.always.rows?.[0]?.cells;
    const eventually = OPERATOR_HINTS.eventually.rows?.[0]?.cells;
    // WHEN reading the cell that decides
    const broken = always?.findIndex((cell) => cell.decisive);
    const met = eventually?.findIndex((cell) => cell.decisive);
    // THEN ALWAYS fails at the fourth cell and EVENTUALLY holds at the third
    expect(broken).toBe(3);
    expect(always?.[3]).toMatchObject({ mark: "✗", tone: "broken" });
    expect(met).toBe(2);
    expect(eventually?.[2]).toMatchObject({ mark: "✓", tone: "holds" });
  });

  it("gives UNTIL and WEAK UNTIL an A row and a B row", () => {
    // GIVEN the two until hints
    // WHEN reading their row tags
    const tags = [OPERATOR_HINTS.until, OPERATOR_HINTS["weak-until"]].map((hint) => hint.rows?.map((row) => row.tag));
    // THEN both are A over B
    expect(tags).toEqual([
      ["A", "B"],
      ["A", "B"],
    ]);
  });
});

describe("WORD_HINTS", () => {
  it("has one plain line for each keyword between parts", () => {
    // GIVEN the words of a block
    // WHEN looking each up
    const lines = ["IF", "THEN", "ELSE", "IFF", "NOT"].map((word) => WORD_HINTS[word]?.line);
    // THEN every word has a line
    expect(lines.every((line) => typeof line === "string" && line.length > 0)).toBe(true);
    expect(WORD_HINTS.NOT?.line).toBe("the opposite");
  });
});
