import type { PetriNetIr, PetriNetIrArcs } from "../ir/schema";
import type { LinearValue } from "./run-linear-graph";

const MODULUS = 2 ** 32;

type Random = {
  unit: () => number;
  int: (min: number, max: number) => number;
  chance: (probability: number) => boolean;
};

/** A small deterministic generator, so a failure names the net that broke. */
function createRandom(seed: number): Random {
  let state = seed % MODULUS;
  function unit(): number {
    state = (state * 1664525 + 1013904223) % MODULUS;
    return state / MODULUS;
  }
  return {
    unit,
    int: (min, max) => min + Math.floor(unit() * (max - min + 1)),
    chance: (probability) => unit() < probability,
  };
}

/** One input arc in five reads its place and one in five is an inhibitor; the rest move tokens. */
const INPUT_KINDS = [undefined, undefined, undefined, "read", "inhibitor"] as const;

function randomArcs(
  random: Random,
  places: string[],
  count: number,
  side: "inputs" | "outputs",
): PetriNetIrArcs {
  const arcs: PetriNetIrArcs = {};
  for (let i = 0; i < count; i++) {
    const place = places[random.int(0, places.length - 1)];
    if (place !== undefined) {
      const weight = random.int(1, 2);
      const kind = side === "inputs" ? INPUT_KINDS[random.int(0, 4)] : undefined;
      arcs[place] =
        weight === 1 && kind === undefined
          ? null
          : { ...(weight === 1 ? {} : { weight }), ...(kind === undefined ? {} : { kind }) };
    }
  }
  return arcs;
}

/**
 * A plain or stochastic net of two to five places and one to five
 * transitions, with weighted, read and inhibitor arcs, capacities and
 * controllable transitions, the same for the same seed.
 */
export function randomNet(seed: number, stochastic: boolean): PetriNetIr {
  const random = createRandom(seed);
  const placeNames = ["A", "B", "C", "D", "E"].slice(0, random.int(2, 5));
  const places: PetriNetIr["places"] = {};
  const marking: Record<string, number> = {};
  for (const name of placeNames) {
    const initial = random.int(0, 3);
    if (initial > 0) {
      marking[name] = initial;
    }
    places[name] = random.chance(0.4) ? { capacity: initial + random.int(0, 2) } : null;
  }
  const transitions: PetriNetIr["transitions"] = {};
  const count = random.int(1, 5);
  for (let i = 0; i < count; i++) {
    transitions[`T${i}`] = {
      ...(random.chance(0.85)
        ? { inputs: randomArcs(random, placeNames, random.int(1, 2), "inputs") }
        : {}),
      ...(random.chance(0.85)
        ? { outputs: randomArcs(random, placeNames, random.int(1, 2), "outputs") }
        : {}),
      ...(stochastic ? { rate: 0.5 + random.unit() * 3 } : {}),
      ...(random.chance(0.3) ? { controllable: true as const } : {}),
    };
  }
  return {
    name: `net${seed}`,
    kind: stochastic ? "stochastic" : "plain",
    places,
    ...(Object.keys(marking).length === 0 ? {} : { marking }),
    transitions,
  };
}

function hash(text: string): number {
  let value = 0;
  for (const char of text) {
    value = (value * 31 + char.charCodeAt(0)) % MODULUS;
  }
  return value;
}

/** One value per input name and step, the same for every shape of a net. */
export function inputsFor(seed: number): (step: number, name: string) => LinearValue {
  return (step, name) => {
    const random = createRandom(seed * 7919 + step * 104729 + hash(name));
    // The first draw of a plain LCG barely moves; skip it.
    random.unit();
    return name.startsWith("go_") ? random.chance(0.6) : random.unit();
  };
}
