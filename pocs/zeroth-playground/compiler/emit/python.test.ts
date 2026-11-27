import { describe, expect, it } from "vitest";

import { composeLines, moduleFileStems } from "./python";
import { written } from "./python-writer";

import type { PetriNetIr } from "../ir/schema";

const ir: PetriNetIr = { name: "birth_death", kind: "stochastic", places: {}, transitions: {} };

/** The lines as they are written, one string each. */
function textOf(lines: Parameters<typeof written>[0]): string[] {
  return written(lines).text.split("\n").slice(0, -1);
}

describe("composeLines", () => {
  it("composes on one line while it fits, with the hidden variables last", () => {
    // GIVEN two instances, then the same two with a hidden clock
    const instances = ["a", "b"];
    // WHEN each is composed
    const plain = textOf(composeLines(instances, [], ir));
    const hiding = textOf(composeLines(instances, ["clk_a"], ir));
    // THEN each fits on one line, the hide set last
    expect(plain).toEqual(["net = compose(a, b)"]);
    expect(hiding).toEqual(["net = compose(a, b, hide={clk_a})"]);
  });

  it("puts one argument per line past the line width, the hide set as the last one", () => {
    // GIVEN three instances whose compose line runs past the width with a hide set,
    // and four whose line runs past it without one
    const instances = ["transition_Birth", "transition_Death", "place_Population"];
    // WHEN each is composed
    const hiding = textOf(composeLines(instances, ["clk_Birth", "clk_Death"], ir));
    const plain = textOf(composeLines([...instances, "place_Graveyard_Of_Names"], [], ir));
    // THEN each argument gets its own line
    expect(hiding).toEqual([
      "net = compose(",
      "    transition_Birth,",
      "    transition_Death,",
      "    place_Population,",
      "    hide={clk_Birth, clk_Death},",
      ")",
    ]);
    expect(plain).toEqual([
      "net = compose(",
      "    transition_Birth,",
      "    transition_Death,",
      "    place_Population,",
      "    place_Graveyard_Of_Names,",
      ")",
    ]);
  });
  it("traces the opening line as the system, each module line as the composition, and the hide set as the private clocks", () => {
    // GIVEN three instances and two hidden clocks, too long for one line
    const lines = composeLines(
      ["transition_Birth", "transition_Death", "place_Population"],
      ["clk_Birth", "clk_Death"],
      ir,
    );
    // WHEN they are written
    const { trace } = written(lines);
    // THEN every line has its own range, all of them from the net
    expect(trace.map(({ startLine, provenance }) => [startLine, provenance.what])).toEqual([
      [1, "The system"],
      [2, "The system"],
      [3, "The system"],
      [4, "The system"],
      [5, "The clocks kept private"],
      [6, "The system"],
    ]);
    expect(trace[0]?.provenance.why).toContain("Every module composed");
    expect(trace[1]?.provenance.why).toBe("The composition, one module per line.");
    expect(trace.every(({ provenance }) => provenance.source?.name === "birth_death")).toBe(true);
  });
});

describe("moduleFileStems", () => {
  it("numbers a stem an earlier class already took", () => {
    // GIVEN three class names that differ by case alone
    const classNames = ["Place_Ab", "Place_AB", "Place_ab"];
    // WHEN each gets a file stem
    const stems = moduleFileStems(classNames);
    // THEN the later ones are numbered
    expect([...stems]).toEqual([
      ["Place_Ab", "place_ab"],
      ["Place_AB", "place_ab_2"],
      ["Place_ab", "place_ab_3"],
    ]);
  });
});
