import type { PetriNetIr } from "../ir/schema";
import type { CompilerOptions } from "../options";

/** Two transitions take from one place, and a third is in no conflict. */
export const forkIr: PetriNetIr = {
  name: "fork",
  kind: "plain",
  places: { Pool: null, Left: null, Right: null },
  marking: { Pool: 3 },
  transitions: {
    TakeLeft: { inputs: { Pool: null }, outputs: { Left: null } },
    TakeRight: { inputs: { Pool: null }, outputs: { Right: null } },
    Return: { inputs: { Left: null }, outputs: { Pool: null } },
  },
};

/** The fork at rates. */
export const forkClockedIr: PetriNetIr = {
  ...forkIr,
  kind: "stochastic",
  transitions: {
    TakeLeft: { inputs: { Pool: null }, outputs: { Left: null }, rate: 1 },
    TakeRight: { inputs: { Pool: null }, outputs: { Right: null }, rate: 2 },
    Return: { inputs: { Left: null }, outputs: { Pool: null }, rate: 0.5 },
  },
};

/** The options the fork at rates is compiled under: clocks, with the conflict left open. */
export const forkClockedOptions: CompilerOptions = { rates: "clock", conflicts: "nondet" };
