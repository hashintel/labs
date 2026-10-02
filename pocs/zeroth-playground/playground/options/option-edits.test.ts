import { describe, expect, it } from "vitest";

import { parsePetriNetIr } from "../../compiler";
import { exampleById } from "../../examples/catalog";
import { sameOptions, withOption } from "./option-edits";

import type { CompilerOptions, PetriNetIr } from "../../compiler";

/** The example's document with the options it opens with. */
function opened(id: string): { ir: PetriNetIr; options: CompilerOptions } {
  const example = exampleById(id);
  const parsed = example === undefined ? undefined : parsePetriNetIr(example.ir);
  if (example === undefined || parsed === undefined || !parsed.ok) {
    throw new Error(`example ${id} does not parse`);
  }
  return { ir: parsed.ir, options: example.options };
}

describe("withOption", () => {
  it("stores only the options off their default that apply to the net", () => {
    // GIVEN the queue, which opens modular with a step of 0.5
    const { ir, options } = opened("queue");
    // WHEN one option at a time is changed
    // THEN the panel keeps what bears on the net, and a text that is not a number changes nothing
    expect(withOption(ir, options, "shape", "monolithic")).toEqual({ dt: 0.5 });
    expect(withOption(ir, options, "dt", "1")).toEqual({ shape: "modular" });
    expect(withOption(ir, { dt: 0.5 }, "dt", "1")).toEqual({});
    expect(withOption(ir, options, "dt", "abc")).toEqual({ shape: "modular", dt: 0.5 });
    expect(withOption(ir, options, "rates", "clock")).toEqual({ rates: "clock" });
  });

  it("drops the options clock rates ignore", () => {
    // GIVEN the fork under clocks, its conflicts left open
    const { ir, options } = opened("fork-clocked");
    // WHEN the shape is changed, then the rates
    // THEN the shape does not stick under clocks, and conflicts survive the move to coins
    expect(withOption(ir, options, "shape", "modular")).toEqual({ rates: "clock", conflicts: "nondet" });
    expect(withOption(ir, options, "rates", "coin")).toEqual({ conflicts: "nondet" });
  });

  it("ignores a value the option does not have", () => {
    // GIVEN the queue
    const { ir, options } = opened("queue");
    // WHEN its shape is set to a value it does not take
    // THEN the options stay as they were
    expect(withOption(ir, options, "shape", "round")).toEqual(options);
  });
});

describe("sameOptions", () => {
  it("compares options as they resolve, so a default written out equals one left out", () => {
    // GIVEN pairs of option sets
    // WHEN they are compared
    // THEN defaults count as left out, and any other value tells them apart
    expect(sameOptions({}, {})).toBe(true);
    expect(sameOptions({ shape: "monolithic", dt: 1 }, {})).toBe(true);
    expect(sameOptions({ dt: 0.5 }, { dt: 0.5 })).toBe(true);
    expect(sameOptions({ dt: 0.5 }, { dt: 0.25 })).toBe(false);
    expect(sameOptions({ rates: "clock" }, {})).toBe(false);
  });
});
