import { describe, expect, it } from "vitest";

import { arcWeight, conflictingTransitions, initialTokens } from "./accessors";

import type { PetriNetIr } from "./schema";

describe("conflictingTransitions", () => {
  it("names the transitions that share an input place, read arcs included, in record order", () => {
    // GIVEN two transitions sharing Pool, one through a read arc, and two that share nothing
    const sharing: PetriNetIr["transitions"] = {
      Lone: { inputs: { A: null } },
      Right: { inputs: { Pool: null, B: null } },
      Left: { inputs: { Pool: { kind: "read" } } },
      Source: { outputs: { Pool: null } },
    };
    const apart: PetriNetIr["transitions"] = {
      Go: { inputs: { A: null }, outputs: { B: null } },
      Back: { inputs: { B: null }, outputs: { A: null } },
    };
    // WHEN the conflicts are found
    const shared = conflictingTransitions(sharing);
    const none = conflictingTransitions(apart);
    // THEN only the transitions sharing an input place are named
    expect([...shared]).toEqual(["Right", "Left"]);
    expect(none.size).toBe(0);
  });
});

describe("IR accessors", () => {
  it("read the defaults behind bare keys", () => {
    // GIVEN bare and explicit arcs and markings
    // THEN the accessors read the defaults the bare keys stand for
    expect(arcWeight(null)).toBe(1);
    expect(arcWeight({ weight: 3 })).toBe(3);
    expect(initialTokens({}, "A")).toBe(0);
    expect(initialTokens({ marking: { A: 4 } }, "A")).toBe(4);
    expect(initialTokens({ marking: { A: 4 } }, "B")).toBe(0);
    expect(initialTokens({ marking: { A: [{ x: 1 }, { x: 2 }] } }, "A")).toBe(2);
  });
});
