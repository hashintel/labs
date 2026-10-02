import { describe, expect, it } from "vitest";

import { resolveOptions } from "../../options";
import { birthDeathIr } from "../../testing/birth-death.fixtures";
import { parseCode } from "../../testing/fixture-parser";
import { lowerPetriNetIr } from "../lower";
import { clockRefusals } from "./refusals";

import type { PetriNetIr } from "../../ir/schema";

const clocks = resolveOptions({ rates: "clock" });

/** The refusals under clock rates, each as its code and item. */
function refusals(ir: PetriNetIr) {
  return clockRefusals(ir).map(({ code, item }) => ({
    code,
    item: { kind: item.kind, name: item.name },
  }));
}

describe("clockRefusals", () => {
  it("accepts the birth-death net", () => {
    // GIVEN the birth-death net, every transition at a constant rate
    // WHEN it is checked
    const found = refusals(birthDeathIr);
    // THEN nothing is refused
    expect(found).toEqual([]);
  });

  it("refuses a transition without a rate, a rate that reads its tokens and one that is not positive", () => {
    // GIVEN a transition with no rate, one whose rate is code and one at rate 0
    const ir: PetriNetIr = {
      ...birthDeathIr,
      kind: "mixed",
      transitions: {
        Birth: { outputs: { Population: null } },
        Death: {
          inputs: { Population: null },
          rate: "return input.Population.length;",
        },
        Plague: { inputs: { Population: null }, rate: 0 },
      },
    };
    // WHEN the net is checked
    const found = refusals(ir);
    // THEN each transition is refused for its own reason
    expect(found).toEqual([
      {
        code: "clocks-plain-transition",
        item: { kind: "transition", name: "Birth" },
      },
      { code: "clocks-rate-code", item: { kind: "transition", name: "Death" } },
      {
        code: "clocks-rate-not-positive",
        item: { kind: "transition", name: "Plague" },
      },
    ]);
  });

  it("refuses a guard and a kernel beside a rate, whether or not the code is parsed", () => {
    // GIVEN a rated transition that also has a guard and a kernel
    const guarded: PetriNetIr = {
      ...birthDeathIr,
      transitions: {
        ...birthDeathIr.transitions,
        Death: {
          ...birthDeathIr.transitions.Death,
          guard: "return input.Population.length > 2;",
          kernel: "return {};",
        },
      },
    };
    // WHEN it is checked, then lowered without and with a parser
    const found = refusals(guarded);
    const lowered = [lowerPetriNetIr(guarded, clocks), lowerPetriNetIr(guarded, clocks, parseCode)];
    // THEN the guard and the kernel are refused before the code is read
    expect(found).toEqual([
      { code: "clocks-guard", item: { kind: "transition", name: "Death" } },
      { code: "clocks-kernel", item: { kind: "transition", name: "Death" } },
    ]);
    for (const outcome of lowered) {
      expect(outcome).toMatchObject({
        ok: false,
        errors: [{ code: "clocks-guard" }, { code: "clocks-kernel" }],
      });
    }
  });

  it("refuses a rate that reads its tokens before the code is read, parser or not", () => {
    // GIVEN the birth-death net whose Death rate reads its tokens
    const coded: PetriNetIr = {
      ...birthDeathIr,
      transitions: {
        ...birthDeathIr.transitions,
        Death: { inputs: { Population: null }, rate: "return input.Population.length;" },
      },
    };
    // WHEN it is lowered without and with a parser
    const lowered = [lowerPetriNetIr(coded, clocks), lowerPetriNetIr(coded, clocks, parseCode)];
    // THEN both refuse the rate as code
    for (const outcome of lowered) {
      expect(outcome).toMatchObject({ ok: false, errors: [{ code: "clocks-rate-code" }] });
    }
  });

  it("refuses arcs that carry more than one token, naming each one", () => {
    // GIVEN a transition with an input arc of weight 2 and an output arc of weight 3
    const ir: PetriNetIr = {
      ...birthDeathIr,
      places: { Population: null, Pairs: null },
      transitions: {
        Pair: {
          inputs: { Population: { weight: 2 } },
          outputs: { Pairs: null, Population: { weight: 3 } },
          rate: 1,
        },
      },
    };
    // WHEN it is checked
    const errors = clockRefusals(ir);
    // THEN one refusal names both arcs
    expect(errors).toEqual([
      {
        code: "clocks-arc-weight",
        message:
          "the clocks strategy moves one token per arc; the arc from Population carries 2, the arc into Population carries 3",
        item: { kind: "transition", name: "Pair" },
      },
    ]);
  });

  it("refuses a capacity", () => {
    // GIVEN the birth-death net with a capped place
    const ir: PetriNetIr = {
      ...birthDeathIr,
      places: { Population: { capacity: 10 } },
    };
    // WHEN the net is checked
    const found = refusals(ir);
    // THEN the place is refused: the counters test against zero only
    expect(found).toEqual([
      { code: "clocks-capacity", item: { kind: "place", name: "Population" } },
    ]);
  });
});
