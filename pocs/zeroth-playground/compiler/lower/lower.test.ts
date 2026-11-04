import { describe, expect, it } from "vitest";

import { conflictingTransitions, initialTokens } from "../ir/accessors";
import { resolveOptions } from "../options";
import { birthDeathIr, birthDeathOptions } from "../testing/birth-death.fixtures";
import { inputsFor, randomNet } from "../testing/random-net";
import { referenceStep } from "../testing/reference-step";
import {
  runLinearGraph,
  moduleAwaits,
  orderLinearModules,
  type LinearValue,
} from "../testing/run-linear-graph";
import { lowerPetriNetIr } from "./lower";

import type { PetriNetIr } from "../ir/schema";
import type { CompilerOptions } from "../options";

function placesOnly(values: Record<string, LinearValue>, ir: PetriNetIr): Record<string, number> {
  return Object.fromEntries(Object.keys(ir.places).map((place) => [place, Number(values[place])]));
}

/** The linear graph of an IR the lowering accepts. */
function lowerGraph(ir: PetriNetIr, options: CompilerOptions = {}) {
  const outcome = lowerPetriNetIr(ir, resolveOptions(options));
  if (!outcome.ok) {
    throw new Error(outcome.errors.map((error) => error.code).join(", "));
  }
  if (outcome.graph.language === "spn") {
    throw new Error("expected a graph in a linear theory");
  }
  return outcome.graph;
}

/** The reference trajectory: the initial marking, then one reference step per round. */
function referenceTrajectory(
  ir: PetriNetIr,
  options: CompilerOptions,
  inputs: (step: number, name: string) => LinearValue,
  steps: number,
): Record<string, number>[] {
  const target = resolveOptions(options);
  const expected: Record<string, number>[] = [
    Object.fromEntries(Object.keys(ir.places).map((place) => [place, initialTokens(ir, place)])),
  ];
  for (let step = 1; step <= steps; step++) {
    expected.push(
      referenceStep(ir, target, expected[step - 1] ?? {}, (name) => inputs(step, name)),
    );
  }
  return expected;
}

// Clock rates are not among them: the interpreter models discrete rounds,
// and an SPN graph runs its clocks in continuous time.
const TARGETS: CompilerOptions[] = [
  {},
  { shape: "modular" },
  { marking: "int" },
  { shape: "modular", marking: "int" },
  { control: "open" },
  { shape: "modular", control: "open", marking: "int", dt: 0.25 },
];

const STEPS = 25;

describe("lowerPetriNetIr", () => {
  it("gives every shape the trajectory of the reference step, on random nets", () => {
    for (let seed = 1; seed <= 150; seed++) {
      for (const stochastic of [false, true]) {
        for (const options of TARGETS) {
          // GIVEN a random net under one option set, and one value per input and round
          const ir = randomNet(seed, stochastic);
          const inputs = inputsFor(seed);
          // WHEN its graph runs for a number of rounds
          const trace = runLinearGraph(lowerGraph(ir, options), {
            steps: STEPS,
            inputs,
          }).map((values) => placesOnly(values, ir));
          // THEN the places follow the reference step round by round
          expect(trace, `seed ${seed} ${ir.kind} ${JSON.stringify(options)}`).toEqual(
            referenceTrajectory(ir, options, inputs, STEPS),
          );
        }
      }
    }
  });

  it("lets a transition module read its places latched and await only earlier transitions", () => {
    for (let seed = 1; seed <= 60; seed++) {
      // GIVEN a random net, modular with an integer marking
      const ir = randomNet(seed, seed % 2 === 0);
      const transitions = Object.keys(ir.transitions);
      // WHEN it is lowered
      const graph = lowerGraph(ir, { shape: "modular", marking: "int" });
      // THEN a transition module awaits only the firings of earlier transitions and its inputs
      for (const module of graph.modules) {
        if (!module.className.startsWith("Transition_")) {
          continue;
        }
        const own = transitions.indexOf(module.className.slice("Transition_".length));
        for (const awaited of moduleAwaits(module)) {
          if (awaited.startsWith("fire_")) {
            const other = transitions.indexOf(awaited.slice("fire_".length));
            expect(other, `${module.className} awaits ${awaited}`).toBeLessThan(own);
          } else {
            expect(awaited).toMatch(/^(hit|go|u)_/u);
          }
        }
      }
      // Kahn's sort accepts it, as composition would.
      expect(orderLinearModules(graph)).toHaveLength(graph.modules.length);
    }
  });

  it("gives a pick to the transitions in a conflict alone, and takes an undriven pick as the sweep", () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const shape of ["monolithic", "modular"] as const) {
        // GIVEN a random net in one shape, with its conflicts swept and left open
        const ir = randomNet(seed, seed % 2 === 0);
        const inputs = inputsFor(seed);
        const open = lowerGraph(ir, { shape, conflicts: "nondet" });
        // WHEN both run, the open one with every pick left undriven
        const sweep = runLinearGraph(lowerGraph(ir, { shape }), { steps: STEPS, inputs });
        const trace = runLinearGraph(open, {
          steps: STEPS,
          inputs: (step, name) => (name.startsWith("pick_") ? undefined : inputs(step, name)),
        });
        // THEN only the transitions in a conflict get a pick, and both runs agree
        expect(
          open.variables
            .filter((variable) => variable.name.startsWith("pick_"))
            .map((variable) => [variable.name, variable.sort, variable.role]),
          `seed ${seed} ${shape}`,
        ).toEqual(
          [...conflictingTransitions(ir.transitions)].map((name) => [
            `pick_${name}`,
            "bool",
            "input",
          ]),
        );
        expect(
          trace.map((values) => placesOnly(values, ir)),
          `seed ${seed} ${shape}`,
        ).toEqual(sweep.map((values) => placesOnly(values, ir)));
      }
    }
  });

  it("holds a transition whose pick is false and refuses another input left without a value", () => {
    // GIVEN a plain fork with its conflict left open, and the same fork with rates
    const fork: PetriNetIr = {
      name: "fork",
      kind: "plain",
      places: { Pool: null, Left: null, Right: null },
      marking: { Pool: 3 },
      transitions: {
        TakeLeft: { inputs: { Pool: null }, outputs: { Left: null } },
        TakeRight: { inputs: { Pool: null }, outputs: { Right: null } },
      },
    };
    const rated: PetriNetIr = {
      ...fork,
      kind: "stochastic",
      transitions: {
        TakeLeft: { ...fork.transitions.TakeLeft, rate: 1 },
        TakeRight: { ...fork.transitions.TakeRight, rate: 1 },
      },
    };
    // WHEN the plain fork runs with TakeLeft's pick false
    const trace = runLinearGraph(lowerGraph(fork, { conflicts: "nondet" }), {
      steps: 3,
      inputs: (_step, name) => name !== "pick_TakeLeft",
    });
    // THEN every token goes right, and the rated fork refuses to run without its draws
    expect(trace.at(-1)).toEqual({ Pool: 0, Left: 0, Right: 3 });
    expect(() =>
      runLinearGraph(lowerGraph(rated, { conflicts: "nondet" }), {
        steps: 1,
        inputs: () => undefined,
      }),
    ).toThrow(/u_TakeLeft has no value for round 1/u);
  });

  it("lowers clock rates to an SPN graph, which the step interpreter refuses to order or run", () => {
    // GIVEN the birth-death net under clock rates
    // WHEN it is lowered
    const outcome = lowerPetriNetIr(birthDeathIr, resolveOptions(birthDeathOptions));
    // THEN it is an SPN graph, which the interpreter does not order or run
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.graph.language).toBe("spn");
    expect(() => orderLinearModules(outcome.graph)).toThrow(/continuous time/u);
    expect(() => runLinearGraph(outcome.graph, { steps: 1, inputs: () => 0 })).toThrow(
      /continuous time/u,
    );
  });

  it("drives every place and flag from exactly one module", () => {
    // GIVEN a random stochastic net, modular with an integer marking and open control
    const ir = randomNet(3, true);
    // WHEN it is lowered
    const graph = lowerGraph(ir, { shape: "modular", marking: "int", control: "open" });
    // THEN each variable but the inputs has exactly one driver
    const drivers = new Map<string, number>();
    for (const module of graph.modules) {
      for (const name of module.ctrl) {
        drivers.set(name, (drivers.get(name) ?? 0) + 1);
      }
    }
    for (const variable of graph.variables) {
      expect(drivers.get(variable.name) ?? 0).toBe(variable.role === "input" ? 0 : 1);
    }
  });
});
