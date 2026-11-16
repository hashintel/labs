import { describe, expect, it } from "vitest";

import { parsePetriNetIr } from "./parse";

/** Each error of a document as its code, item and line; empty when it parses. */
function issues(lines: readonly string[]) {
  const parsed = parsePetriNetIr(lines.join("\n"));
  return parsed.ok
    ? []
    : parsed.errors.map(({ code, item, line }) => [code, `${item.kind} ${item.name}`, line]);
}

/** A net of the given kind with one transition per rate, each taking from A; an empty rate is none. */
function netOfKind(kind: string, rates: readonly string[]): string[] {
  return [
    "name: cycle",
    `kind: ${kind}`,
    "places:",
    "  A:",
    "transitions:",
    ...rates.flatMap((rate, index) => [
      `  T${index}:`,
      "    inputs:",
      "      A:",
      ...(rate === "" ? [] : [`    rate: ${rate}`]),
    ]),
  ];
}

describe("the references between the sections of a document", () => {
  it("reports an arc and a marking entry that name no declared place", () => {
    // GIVEN a cycle whose arc and marking name a place C that is not declared
    const lines = [
      "name: cycle",
      "kind: plain",
      "places:",
      "  A:",
      "  B:",
      "marking:",
      "  C: 1",
      "transitions:",
      "  Go:",
      "    inputs:",
      "      A:",
      "    outputs:",
      "      C:",
    ];
    // WHEN it is parsed
    const found = issues(lines);
    // THEN each reference is one error at its own key
    expect(found).toEqual([
      ["unknown-place", "transition Go", 13],
      ["unknown-place", "place C", 7],
    ]);
  });

  it("reports a colour and dynamics that are not declared", () => {
    // GIVEN a place of an undeclared colour, a place with undeclared dynamics, and dynamics of an undeclared colour
    const lines = [
      "name: tank",
      "kind: plain",
      "colours:",
      "  Water:",
      "    level: real",
      "dynamics:",
      "  Drain:",
      "    colour: Oil",
      "    code: return tokens;",
      "places:",
      "  Tank:",
      "    colour: Mud",
      "  Sump:",
      "    colour: Water",
      "    dynamics: Fill",
      "transitions: {}",
    ];
    // WHEN it is parsed
    const found = issues(lines);
    // THEN each name is one error on the item that uses it
    expect(found).toEqual([
      ["unknown-colour", "place Tank", 12],
      ["unknown-dynamics", "place Sump", 15],
      ["unknown-colour", "dynamics Drain", 8],
    ]);
  });

  it("reports a name the generated Python uses, and a net whose class would take one", () => {
    // GIVEN a net named event, with a place Event and a transition Module
    const lines = [
      "name: event",
      "kind: plain",
      "places:",
      "  Event:",
      "  Pool:",
      "transitions:",
      "  Module:",
      "    inputs:",
      "      Pool:",
    ];
    // WHEN it is parsed
    const found = issues(lines);
    // THEN the place, the transition and the net's name are each reserved
    expect(found).toEqual([
      ["reserved-name", "place Event", 4],
      ["reserved-name", "transition Module", 7],
      ["reserved-name", "net name", 1],
    ]);
  });

  it("reports a marking that is not a whole count on a plain place or a token list on a coloured one", () => {
    // GIVEN plain places starting at -1, at 1.5 and with a token list, and a coloured place starting at a count
    const lines = [
      "name: bad_marking",
      "kind: plain",
      "colours:",
      "  Ball:",
      "    x: real",
      "places:",
      "  Debt:",
      "  Half:",
      "  Listed:",
      "  Balls:",
      "    colour: Ball",
      "marking:",
      "  Debt: -1",
      "  Half: 1.5",
      "  Listed:",
      "    - {x: 1}",
      "  Balls: 2",
      "transitions: {}",
    ];
    // WHEN it is parsed
    const found = issues(lines);
    // THEN each place's marking is invalid
    expect(found).toEqual([
      ["marking-invalid", "place Debt", 13],
      ["marking-invalid", "place Half", 14],
      ["marking-invalid", "place Listed", 15],
      ["marking-invalid", "place Balls", 17],
    ]);
  });

  it("reports a marking over the place's capacity, as a count or as tokens", () => {
    // GIVEN a plain place of capacity 2 starting with 3 tokens, and a coloured one of capacity 1 starting with 2
    const lines = [
      "name: full",
      "kind: plain",
      "colours:",
      "  Ball:",
      "    x: real",
      "places:",
      "  Pool:",
      "    capacity: 2",
      "  Bag:",
      "    colour: Ball",
      "    capacity: 1",
      "marking:",
      "  Pool: 3",
      "  Bag:",
      "    - {x: 1}",
      "    - {x: 2}",
      "transitions: {}",
    ];
    // WHEN it is parsed
    const found = issues(lines);
    // THEN both are over capacity
    expect(found).toEqual([
      ["marking-over-capacity", "place Pool", 13],
      ["marking-over-capacity", "place Bag", 14],
    ]);
  });

  it("reports a kind the rates do not give", () => {
    // GIVEN a net called stochastic with one rated and one unrated transition, and one called plain with a rate
    // WHEN each is parsed, beside the nets whose kind matches
    const found = [
      issues(netOfKind("stochastic", ["1", ""])),
      issues(netOfKind("plain", ["1"])),
      issues(netOfKind("mixed", ["1", "1"])),
      issues(netOfKind("mixed", ["1", ""])),
      issues(netOfKind("stochastic", ["1", "return 2;"])),
      issues(netOfKind("plain", [""])),
    ];
    // THEN only the three that disagree are reported, at the kind
    expect(found).toEqual([
      [["kind-mismatch", "net kind", 2]],
      [["kind-mismatch", "net kind", 2]],
      [["kind-mismatch", "net kind", 2]],
      [],
      [],
      [],
    ]);
  });

  it("checks the references only once the shape is right", () => {
    // GIVEN a document with a misspelt key and an arc to an undeclared place
    const lines = [
      "name: cycle",
      "kind: plain",
      "places:",
      "  A:",
      "transitions:",
      "  Go:",
      "    inputs:",
      "      C:",
      "    output:",
      "      A:",
    ];
    // WHEN it is parsed
    const found = issues(lines);
    // THEN only the shape is reported
    expect(found).toEqual([["schema", "transition Go", 6]]);
  });
});
