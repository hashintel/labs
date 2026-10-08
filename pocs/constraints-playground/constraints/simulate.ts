import type { PetriNetIr } from "../compiler/ir/schema";
import type { Diagnostic } from "./diagnostics";

/** One state of a run: the marking after `step` firings. */
export type RunState = {
  step: number;
  time: number;
  marking: Record<string, number>;
  /** Firings per transition from the start of the run up to this state. */
  fired: Record<string, number>;
  /** The transition that fired into this state. Absent at step 0. */
  firedTransition?: string;
};

export type RunSettings = { seed: number; maxSteps: number; maxTime?: number };

export type StopReason = "max-steps" | "max-time" | "deadlock" | "refused";

export type RunResult = { states: RunState[]; stopReason: StopReason; diagnostics: Diagnostic[] };

/** Mulberry32: a small seeded generator giving numbers in [0, 1). */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

type Arc = { place: string; weight: number; kind: "standard" | "read" | "inhibitor" };

type Model = {
  name: string;
  inputs: Arc[];
  outputs: Arc[];
  /** Net token change per place of one firing. */
  delta: Map<string, number>;
  rate?: number;
};

type Marking = Record<string, number>;

/** Everything the run cannot do: the net asks for code, colours or dynamics. */
function refusals(ir: PetriNetIr): Diagnostic[] {
  const refused: Diagnostic[] = [];
  const refuse = (message: string, item: string) =>
    refused.push({ severity: "error", message, item });
  for (const [name, place] of Object.entries(ir.places)) {
    if (place?.colour !== undefined) {
      refuse(`Place ${name} is coloured. The playground runs plain tokens only`, `place ${name}`);
    }
    if (place?.dynamics !== undefined) {
      refuse(`Place ${name} has dynamics. The playground runs plain tokens only`, `place ${name}`);
    }
  }
  for (const [name, count] of Object.entries(ir.marking ?? {})) {
    if (typeof count !== "number") {
      refuse(`Place ${name} starts with coloured tokens. The playground runs plain tokens only`, `place ${name}`);
    }
  }
  for (const [name, transition] of Object.entries(ir.transitions)) {
    const item = `transition ${name}`;
    if (transition.guard !== undefined) {
      refuse(`Transition ${name} has a guard. The playground has no code parser`, item);
    }
    if (transition.kernel !== undefined) {
      refuse(`Transition ${name} has a kernel. The playground has no code parser`, item);
    }
    if (typeof transition.rate === "string") {
      refuse(`Transition ${name} has a rate written as code. Use a number`, item);
    }
  }
  return refused;
}

function arcsOf(arcs: Record<string, { weight?: number; kind?: "read" | "inhibitor" } | null> | undefined): Arc[] {
  return Object.entries(arcs ?? {}).map(([place, arc]) => ({
    place,
    weight: arc?.weight ?? 1,
    kind: arc?.kind ?? "standard",
  }));
}

function buildModels(ir: PetriNetIr): Model[] {
  return Object.entries(ir.transitions).map(([name, transition]) => {
    const inputs = arcsOf(transition.inputs);
    const outputs = arcsOf(transition.outputs);
    const delta = new Map<string, number>();
    for (const arc of inputs) {
      if (arc.kind === "standard") {
        delta.set(arc.place, (delta.get(arc.place) ?? 0) - arc.weight);
      }
    }
    for (const arc of outputs) {
      delta.set(arc.place, (delta.get(arc.place) ?? 0) + arc.weight);
    }
    return {
      name,
      inputs,
      outputs,
      delta,
      ...(typeof transition.rate === "number" ? { rate: transition.rate } : {}),
    };
  });
}

/** Arcs allow it, and no place with capacity would end above it. */
function isEnabled(model: Model, marking: Marking, ir: PetriNetIr): boolean {
  for (const arc of model.inputs) {
    const held = marking[arc.place] ?? 0;
    if (arc.kind === "inhibitor" ? held >= arc.weight : held < arc.weight) {
      return false;
    }
  }
  for (const [place, change] of model.delta) {
    const capacity = ir.places[place]?.capacity;
    if (change > 0 && capacity !== undefined && (marking[place] ?? 0) + change > capacity) {
      return false;
    }
  }
  return true;
}

function initialMarking(ir: PetriNetIr): Marking {
  const marking: Marking = {};
  for (const place of Object.keys(ir.places)) {
    const count = ir.marking?.[place];
    marking[place] = typeof count === "number" ? count : 0;
  }
  return marking;
}

/**
 * Runs the net one firing per state. Plain transitions fire first, one per
 * step, chosen uniformly among the enabled ones. With none enabled, the
 * enabled stochastic transitions race (Gillespie): the wait is exponential in
 * the total rate and the winner is picked in proportion to its rate.
 */
export function simulate(ir: PetriNetIr, settings: RunSettings): RunResult {
  const marking = initialMarking(ir);
  const fired: Record<string, number> = Object.fromEntries(
    Object.keys(ir.transitions).map((name) => [name, 0]),
  );
  const first: RunState = { step: 0, time: 0, marking: { ...marking }, fired: { ...fired } };
  const diagnostics = refusals(ir);
  if (diagnostics.length > 0) {
    return { states: [first], stopReason: "refused", diagnostics };
  }

  const models = buildModels(ir);
  const random = createRandom(settings.seed);
  const states = [first];
  let time = 0;
  for (;;) {
    const enabled = models.filter((model) => isEnabled(model, marking, ir));
    const plain = enabled.filter((model) => model.rate === undefined);
    const racing = enabled.filter((model) => model.rate !== undefined && model.rate > 0);
    if (plain.length === 0 && racing.length === 0) {
      return { states, stopReason: "deadlock", diagnostics };
    }
    if (states.length - 1 >= settings.maxSteps) {
      return { states, stopReason: "max-steps", diagnostics };
    }

    let chosen: Model | undefined;
    if (plain.length > 0) {
      chosen = plain[Math.floor(random() * plain.length)];
    } else {
      const total = racing.reduce((sum, model) => sum + (model.rate ?? 0), 0);
      const wait = -Math.log(1 - random()) / total;
      if (settings.maxTime !== undefined && time + wait > settings.maxTime) {
        return { states, stopReason: "max-time", diagnostics };
      }
      time += wait;
      let target = random() * total;
      chosen = racing[racing.length - 1];
      for (const model of racing) {
        target -= model.rate ?? 0;
        if (target < 0) {
          chosen = model;
          break;
        }
      }
    }
    if (chosen === undefined) {
      throw new Error("a firing is chosen whenever a transition is enabled");
    }

    for (const [place, change] of chosen.delta) {
      marking[place] = (marking[place] ?? 0) + change;
    }
    fired[chosen.name] = (fired[chosen.name] ?? 0) + 1;
    states.push({
      step: states.length,
      time,
      marking: { ...marking },
      fired: { ...fired },
      firedTransition: chosen.name,
    });
  }
}
