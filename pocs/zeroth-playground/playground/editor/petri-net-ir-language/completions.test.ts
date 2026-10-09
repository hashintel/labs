import { describe, expect, it } from "vitest";

import { completionsAt, cursorContext } from "./completions";

const DOC = [
  "name: drones",
  "kind: mixed",
  "",
  "colours:",
  "  Drone:",
  "    battery: real",
  "",
  "places:",
  "  Hangar:",
  "    colour: Drone",
  "  Airborne:",
  "",
  "transitions:",
  "  Launch:",
  "    inputs:",
  "      Hangar:",
  "    outputs:",
  "      ",
  "    ",
].join("\n");

function labels(line: number, column: number): string[] {
  return completionsAt(DOC, line, column).map((completion) => completion.label);
}

describe("cursorContext", () => {
  it("reads the parent path from the indentation and the names declared above", () => {
    // GIVEN the Drones document, the cursor on the empty line under Launch's outputs
    // WHEN the context at the cursor is read
    const context = cursorContext(DOC, 18, 7);
    // THEN it sits under the outputs, after no key, with the places and colours declared above
    expect(context.parentPath).toEqual(["transitions", "Launch", "outputs"]);
    expect(context.valueOf).toBeNull();
    expect(context.places).toEqual(["Hangar", "Airborne"]);
    expect(context.colours).toEqual(["Drone"]);
  });

  it("names the key whose value the cursor sits after", () => {
    // GIVEN the cursor after Hangar's "colour:"
    // WHEN the context at the cursor is read
    const context = cursorContext(DOC, 10, 13);
    // THEN it is the value of colour, under the place
    expect(context).toMatchObject({
      parentPath: ["places", "Hangar"],
      valueOf: "colour",
    });
  });
});

describe("completionsAt", () => {
  it("offers the section keys at the top level", () => {
    // GIVEN the cursor on a blank line at the top level
    // WHEN completions are asked for
    const offered = labels(3, 1);
    // THEN every section is offered, in the schema's order
    expect(offered).toEqual([
      "name",
      "description",
      "kind",
      "colours",
      "dynamics",
      "places",
      "marking",
      "transitions",
    ]);
  });

  it("offers a place's, a transition's and an arc's keys by nesting level", () => {
    // GIVEN the cursor inside a transition, a place and an arc
    // WHEN completions are asked for at each
    const transition = labels(19, 5);
    const place = completionsAt("places:\n  A:\n    ", 3, 5).map((c) => c.label);
    const arc = completionsAt("transitions:\n  Go:\n    inputs:\n      A:\n        ", 5, 9).map(
      (c) => c.label,
    );
    // THEN each offers the keys of its own level
    expect(transition).toEqual(["inputs", "outputs", "guard", "rate", "kernel", "controllable"]);
    expect(place).toEqual(["capacity", "colour", "dynamics"]);
    expect(arc).toEqual(["weight", "kind"]);
  });

  it("offers the places declared above the cursor under an arc list and the marking", () => {
    // GIVEN the cursor under Launch's outputs, and under a marking
    // WHEN completions are asked for at each
    const outputs = completionsAt(DOC, 18, 7);
    const marking = completionsAt("places:\n  A:\n  B:\n\nmarking:\n  ", 6, 3).map((c) => c.label);
    // THEN both offer the declared places, and a completion inserts the place as a key
    expect(outputs.map((completion) => completion.label)).toEqual(["Hangar", "Airborne"]);
    expect(outputs[0]?.insertText).toBe("Hangar:");
    expect(marking).toEqual(["A", "B"]);
  });

  it("offers a key's values after its colon", () => {
    // GIVEN the cursor after a place's colour, the net's kind and an arc's kind
    // WHEN completions are asked for at each
    const colour = labels(10, 13);
    const netKind = completionsAt("kind: ", 1, 7).map((c) => c.label);
    const arcKind = completionsAt("transitions:\n  Go:\n    inputs:\n      A:\n        kind: ", 5, 15).map(
      (c) => c.label,
    );
    // THEN each offers the values its key takes: the declared colours, or the schema's values
    expect(colour).toEqual(["Drone"]);
    expect(netKind).toEqual(["plain", "stochastic", "mixed"]);
    expect(arcKind).toEqual(["read", "inhibitor"]);
  });
});
