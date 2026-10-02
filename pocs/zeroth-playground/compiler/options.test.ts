import { describe, expect, it } from "vitest";

import {
  OPTIONS,
  droppedOptions,
  netFacts,
  optionStates,
  optionsForNet,
  resolveOptions,
} from "./options";

import type { PetriNetIr } from "./ir/schema";
import type { CompilerOptions } from "./options";

/** Two plain transitions in a row, a weighted arc and a capped place. */
const weightedCycle: PetriNetIr = {
  name: "cycle",
  kind: "plain",
  places: { A: null, B: null, C: { capacity: 3 } },
  marking: { A: 1 },
  transitions: {
    Go: { inputs: { A: null }, outputs: { B: { weight: 2 } } },
    Back: { inputs: { B: null }, outputs: { C: null } },
  },
};

/** One stochastic transition. */
const stochastic: PetriNetIr = {
  name: "arrivals",
  kind: "stochastic",
  places: { Arrived: null },
  transitions: { Arrive: { outputs: { Arrived: null }, rate: 2 } },
};

/** One plain transition the environment controls. */
const controllable: PetriNetIr = {
  name: "switch",
  kind: "plain",
  places: { A: null },
  transitions: { Go: { inputs: { A: null }, controllable: true } },
};

/** Two stochastic transitions that share the input place Pool. */
const fork: PetriNetIr = {
  name: "fork",
  kind: "stochastic",
  places: { Pool: null },
  marking: { Pool: 3 },
  transitions: {
    Left: { inputs: { Pool: null }, rate: 1 },
    Right: { inputs: { Pool: null }, rate: 2 },
  },
};

/** A stochastic net whose one place holds coloured tokens. */
const coloured: PetriNetIr = {
  name: "pool",
  kind: "stochastic",
  colours: { Ball: { size: "real" } },
  places: { Pool: { colour: "Ball" } },
  transitions: { Take: { inputs: { Pool: null }, rate: 1 } },
};

/** The options that do not apply to the net, by name. */
function notApplicable(ir: PetriNetIr, options?: CompilerOptions): string[] {
  return optionStates(ir, options)
    .filter((state) => state.notApplicable !== undefined)
    .map((state) => state.name);
}

describe("resolveOptions", () => {
  it("gives every option a value, the default where none is given", () => {
    // GIVEN no options, and the modular shape alone
    // WHEN they are resolved
    const defaults = resolveOptions();
    const modular = resolveOptions({ shape: "modular" });
    // THEN every option has a value, the first of its values or its number
    expect(defaults).toEqual({
      shape: "monolithic",
      rates: "coin",
      conflicts: "sweep",
      marking: "real",
      control: "closed",
      dt: 1,
      slots: 8,
      layout: "single",
    });
    expect(modular).toEqual({ ...defaults, shape: "modular" });
  });

  it("takes each choice's first value as its default", () => {
    // GIVEN the options table
    // WHEN each choice's default is read
    const choices = Object.values(OPTIONS).filter((spec) => spec.values !== null);
    // THEN it is the first value listed
    for (const spec of choices) {
      expect(spec.values?.[0]).toBe(spec.default);
    }
  });
});

describe("netFacts", () => {
  it("reads whether the net is stochastic off its rates, not off its kind", () => {
    // GIVEN a net that says it is mixed but has no rate
    const unrated: PetriNetIr = { ...weightedCycle, kind: "mixed" };
    // WHEN its facts are read
    const facts = netFacts(unrated);
    // THEN it is not stochastic, so the rate options do not apply
    expect(facts.stochastic).toBe(false);
    expect(notApplicable(unrated)).toContain("rates");
  });

  it("puts clock rates in force only on a stochastic net without colours or dynamics", () => {
    // GIVEN clock rates asked for on a stochastic net, a plain net and a coloured net
    const clock: CompilerOptions = { rates: "clock" };
    // WHEN the facts are read
    // THEN only the stochastic net runs on clocks
    expect(netFacts(stochastic, clock).clocks).toBe(true);
    expect(netFacts(weightedCycle, clock).clocks).toBe(false);
    expect(netFacts(coloured, clock).clocks).toBe(false);
  });
});

describe("optionStates", () => {
  it("greys out what does not apply to a plain net without conflicts", () => {
    // GIVEN the weighted cycle, under the modular shape and under the defaults
    // WHEN its options are read
    // THEN the rate, choice and colour options do not apply, and the layout only under modular
    expect(notApplicable(weightedCycle, { shape: "modular" })).toEqual([
      "rates",
      "conflicts",
      "marking",
      "control",
      "dt",
      "slots",
    ]);
    expect(notApplicable(weightedCycle)).toContain("layout");
  });

  it("keeps rates, conflicts and layout alone under clock rates", () => {
    // GIVEN the fork under clock rates with its conflicts left open
    const options: CompilerOptions = { rates: "clock", conflicts: "nondet" };
    // WHEN its options are read
    const states = optionStates(fork, options);
    // THEN the step options do not apply, and conflicts holds its value
    expect(notApplicable(fork, options)).toEqual(["shape", "marking", "control", "dt", "slots"]);
    expect(states.find((state) => state.name === "conflicts")?.value).toBe("nondet");
    expect(states.find((state) => state.name === "shape")?.notApplicable).toBe(
      "Clock rates compose the modules in continuous time; there is no step.",
    );
  });

  it("gives a coloured net slots and no rates or marking", () => {
    // GIVEN a coloured stochastic net
    // WHEN its options are read
    // THEN slots apply, and the rates and the marking do not
    expect(notApplicable(coloured)).toEqual(["rates", "conflicts", "marking", "control", "layout"]);
  });

  it("reads the value in force, and lists the values to pick from", () => {
    // GIVEN the stochastic net, modular with a step of 0.5
    // WHEN its options are read
    const states = optionStates(stochastic, { shape: "modular", dt: 0.5 });
    // THEN each value is the one given or the default, and a number has no list
    expect(Object.fromEntries(states.map((state) => [state.name, state.value]))).toEqual({
      shape: "modular",
      rates: "coin",
      conflicts: "sweep",
      marking: "real",
      control: "closed",
      dt: "0.5",
      slots: "8",
      layout: "single",
    });
    expect(states.find((state) => state.name === "shape")?.values).toEqual([
      "monolithic",
      "modular",
    ]);
    expect(states.find((state) => state.name === "dt")?.values).toBeNull();
  });
});

describe("optionsForNet", () => {
  it("keeps only the options off their default", () => {
    // GIVEN a stochastic net
    // WHEN no options, options at their defaults and options off their defaults are asked for
    const unset = optionsForNet(undefined, stochastic);
    const defaults = optionsForNet(
      { shape: "monolithic", marking: "real", control: "closed", dt: 1 },
      stochastic,
    );
    const changed = optionsForNet({ shape: "modular", marking: "int", dt: 0.5 }, stochastic);
    // THEN only the options off their default are kept
    expect(unset).toEqual({});
    expect(defaults).toEqual({});
    expect(changed).toEqual({ shape: "modular", marking: "int", dt: 0.5 });
  });

  it("drops the options that do not apply to the net", () => {
    // GIVEN a plain net, and a plain net with a controllable transition
    // WHEN options for stochastic and controllable nets are asked for
    const plain = optionsForNet({ marking: "int", dt: 0.5, control: "open" }, weightedCycle);
    const open = optionsForNet({ marking: "int", control: "open" }, controllable);
    // THEN each net keeps only the options that bear on it
    expect(plain).toEqual({});
    expect(open).toEqual({ control: "open" });
  });

  it("keeps the rates for a stochastic net without colours, and drops the step options under clocks", () => {
    // GIVEN every option set, and a stochastic net, the plain cycle and a coloured net
    const busy: CompilerOptions = {
      rates: "clock",
      shape: "modular",
      marking: "int",
      control: "open",
      dt: 0.5,
      layout: "per-module",
    };
    const rated: PetriNetIr = {
      ...stochastic,
      transitions: { Arrive: { outputs: { Arrived: null }, rate: 2, controllable: true } },
    };
    // WHEN the options are kept for each net
    const clocked = optionsForNet(busy, rated);
    const plain = optionsForNet(busy, weightedCycle);
    const colouredClocks = optionsForNet({ rates: "clock" }, coloured);
    const coins = optionsForNet({ rates: "coin" }, rated);
    // THEN clocks drop the step options, and only a stochastic net without colours keeps the rates
    expect(clocked).toEqual({ rates: "clock", layout: "per-module" });
    expect(plain).toEqual({ shape: "modular", layout: "per-module" });
    expect(colouredClocks).toEqual({});
    expect(coins).toEqual({});
  });

  it("keeps conflicts for a net where two transitions share an input place, under either rates", () => {
    // GIVEN the fork, a single stochastic transition and the plain cycle
    // WHEN conflicts are asked to stay open on each
    const coins = optionsForNet({ conflicts: "nondet" }, fork);
    const clocks = optionsForNet({ rates: "clock", conflicts: "nondet" }, fork);
    const sweep = optionsForNet({ conflicts: "sweep" }, fork);
    const single = optionsForNet({ conflicts: "nondet" }, stochastic);
    const plain = optionsForNet({ conflicts: "nondet" }, weightedCycle);
    // THEN only the fork keeps it, and only off its default
    expect(coins).toEqual({ conflicts: "nondet" });
    expect(clocks).toEqual({ rates: "clock", conflicts: "nondet" });
    expect(sweep).toEqual({});
    expect(single).toEqual({});
    expect(plain).toEqual({});
  });

  it("keeps the layout only for a composed system", () => {
    // GIVEN a stochastic net
    // WHEN the layout is asked for alone, then under modular at its default and per module
    const alone = optionsForNet({ layout: "per-module" }, stochastic);
    const single = optionsForNet({ shape: "modular", layout: "single" }, stochastic);
    const perModule = optionsForNet({ shape: "modular", layout: "per-module" }, stochastic);
    const clocks = optionsForNet({ rates: "clock", layout: "per-module" }, stochastic);
    // THEN only the modular shape or clock rates keep a layout off its default
    expect(alone).toEqual({});
    expect(single).toEqual({ shape: "modular" });
    expect(perModule).toEqual({ shape: "modular", layout: "per-module" });
    expect(clocks).toEqual({ rates: "clock", layout: "per-module" });
  });
});

describe("droppedOptions", () => {
  it("warns once per option off its default that does not apply, with the reason the panel shows", () => {
    // GIVEN clock rates asked for on a coloured net, with control open and the default shape
    const options: CompilerOptions = { rates: "clock", control: "open", shape: "monolithic" };
    // WHEN the dropped options are read
    const warnings = droppedOptions(options, coloured);
    // THEN each dropped option is one warning on the net, quoting its reason
    const reasons = optionStates(coloured, options);
    expect(warnings).toEqual(
      ["rates", "control"].map((name) => ({
        code: "option-not-applicable",
        message: `${name}: ${name === "rates" ? "clock" : "open"} is ignored. ${
          reasons.find((state) => state.name === name)?.notApplicable
        }`,
        item: { kind: "net", name: "pool" },
      })),
    );
  });

  it("drops exactly what optionsForNet leaves out", () => {
    // GIVEN every option off its default, on the fork under clocks
    const options: CompilerOptions = {
      shape: "modular",
      rates: "clock",
      conflicts: "nondet",
      marking: "int",
      control: "open",
      dt: 0.5,
      slots: 4,
      layout: "per-module",
    };
    // WHEN the options are kept and dropped
    const kept = Object.keys(optionsForNet(options, fork));
    const dropped = droppedOptions(options, fork).map((warning) => warning.message.split(":")[0]);
    // THEN every option is either kept or dropped, never both
    expect(kept).toEqual(["rates", "conflicts", "layout"]);
    expect(dropped).toEqual(["shape", "marking", "control", "dt", "slots"]);
  });
});
