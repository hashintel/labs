import { arcKind, arcWeight, conflictingTransitions, initialTokens } from "../ir/accessors";
import { netFacts } from "../options";
import { layoutColouredPlaces, type PlaceLayout } from "./colour-layout";

import type { CodeFunction, CodeParser, CodeSurface } from "../code/code-tree";
import type { Diagnostic } from "../diagnostics";
import type { PetriNetIr, PetriNetIrToken, PetriNetIrTransition } from "../ir/schema";
import type { NetFacts, ResolvedOptions } from "../options";

/**
 * One step of the net, read off the IR once for every shape: which places
 * each transition takes from and adds to, the net change it makes, the
 * threshold its draw is tested against, the code it runs, how each coloured
 * place lays out its tokens, and which capped places need their pending
 * tokens tracked.
 */

/** The tokens a transition moves per place, in arc order. */
export type PlannedArcs = [place: string, weight: number][];

export type PlannedArc = {
  place: string;
  weight: number;
  kind: "standard" | "read" | "inhibitor";
};

export type PlannedTransition = {
  name: string;
  /** `Go: A -> B`, the transition as a reader sees it. */
  description: string;
  /** Every input arc, in binding order. */
  inputArcs: PlannedArc[];
  /** Standard input arcs summed per place. */
  consumes: PlannedArcs;
  produces: PlannedArcs;
  /** Net tokens a firing adds to each place it touches; zero entries left out. */
  deltas: Map<string, number>;
  /** A constant rate: mean firings per time unit while enabled. */
  rate: number | null;
  /** A constant rate's test: the transition fires when its draw is at least `e^(-rate * dt)`. */
  threshold: number | null;
  /** A rate computed from the input tokens. */
  rateCode: CodeFunction | null;
  /** A predicate's condition over the input tokens. */
  guard: CodeFunction | null;
  /** The kernel writing the produced tokens' attributes. */
  kernel: CodeFunction | null;
  /** The model marks the firing as a controller's choice. */
  controllable: boolean;
  /** Shares an input place with another transition. */
  conflicting: boolean;
};

export type PlannedPlace = {
  name: string;
  initial: number;
  /** A coloured place's starting tokens, in the marking's order. */
  rows: PetriNetIrToken[];
  capacity: number | undefined;
  /** The slots and attributes of a coloured place. */
  layout: PlaceLayout | null;
  /** The equation moving its tokens between steps. */
  dynamics: CodeFunction | null;
};

export type StepPlan = {
  /** The net's name, which names the monolithic module. */
  name: string;
  /** Whether the net is stochastic, coloured or dynamic, as the options read it. */
  facts: NetFacts;
  kind: PetriNetIr["kind"];
  options: ResolvedOptions;
  places: PlannedPlace[];
  layouts: Map<string, PlaceLayout>;
  /** Capped places some transition produces into, with their capacity: their pending tokens count. */
  capped: Map<string, number>;
  transitions: PlannedTransition[];
};

/** Tokens an arc side moves per place: its standard arcs, one per place. */
function sideTotals(arcs: PetriNetIrTransition["inputs"]): PlannedArcs {
  return Object.entries(arcs ?? {})
    .filter(([, arc]) => arcKind(arc) === "standard")
    .map(([place, arc]) => [place, arcWeight(arc)]);
}

function netDeltas(consumes: PlannedArcs, produces: PlannedArcs): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const [place, weight] of produces) {
    deltas.set(place, (deltas.get(place) ?? 0) + weight);
  }
  for (const [place, weight] of consumes) {
    deltas.set(place, (deltas.get(place) ?? 0) - weight);
  }
  for (const [place, delta] of deltas) {
    if (delta === 0) {
      deltas.delete(place);
    }
  }
  return deltas;
}

function describeSide(arcs: PlannedArcs): string {
  return (
    arcs.map(([place, weight]) => (weight === 1 ? place : `${weight} ${place}`)).join(", ") ||
    "nothing"
  );
}

function describeInputs(arcs: PlannedArc[]): string {
  return (
    arcs
      .map(
        ({ place, weight, kind }) =>
          `${kind === "standard" ? "" : `${kind} `}${weight === 1 ? place : `${weight} ${place}`}`,
      )
      .join(", ") || "nothing"
  );
}

/** The surface each kind of code is parsed as. */
const SURFACES = {
  guard: "lambda",
  rate: "lambda",
  kernel: "kernel",
  dynamics: "dynamics",
} as const satisfies Record<string, CodeSurface>;

/** Parses one code string, reporting one that no parser reads. */
function parsed(
  code: string | undefined,
  what: keyof typeof SURFACES,
  parse: CodeParser | undefined,
  item: Diagnostic["item"],
  errors: Diagnostic[],
): CodeFunction | null {
  if (code === undefined) {
    return null;
  }
  const fn = parse?.(code, SURFACES[what]);
  if (fn === undefined) {
    errors.push({
      code: "code-not-parsed",
      message:
        parse === undefined
          ? `no code parser was given to read the ${what}`
          : `the code parser returned no tree for the ${what}`,
      item,
    });
    return null;
  }
  return fn;
}

/** `input.P.length` for a transition: the weight of its standard or read arc from P. */
export function inputTokenCount(
  transition: PlannedTransition,
): (place: string) => number | undefined {
  return (place) =>
    transition.inputArcs.find((arc) => arc.place === place && arc.kind !== "inhibitor")?.weight;
}

export function planStep(
  ir: PetriNetIr,
  options: ResolvedOptions,
  parse: CodeParser | undefined,
  errors: Diagnostic[],
): StepPlan {
  const layouts = layoutColouredPlaces(ir, options, errors);
  const places: PlannedPlace[] = Object.entries(ir.places).map(([name, place]) => {
    const item = { kind: "place" as const, name };
    const equation = place?.dynamics === undefined ? undefined : ir.dynamics?.[place.dynamics];
    const marking = ir.marking?.[name];
    return {
      name,
      initial: initialTokens(ir, name),
      rows: Array.isArray(marking) ? marking : [],
      capacity: place?.capacity,
      layout: layouts.get(name) ?? null,
      dynamics: parsed(equation?.code, "dynamics", parse, item, errors),
    };
  });
  const conflicting = conflictingTransitions(ir.transitions);
  const transitions: PlannedTransition[] = Object.entries(ir.transitions).map(
    ([name, transition]) => {
      const item = { kind: "transition" as const, name };
      const inputArcs: PlannedArc[] = Object.entries(transition.inputs ?? {}).map(
        ([place, arc]) => ({
          place,
          weight: arcWeight(arc),
          kind: arcKind(arc),
        }),
      );
      const consumes = sideTotals(transition.inputs);
      const produces = sideTotals(transition.outputs);
      const rate = typeof transition.rate === "number" ? transition.rate : null;
      return {
        name,
        description: `${name}: ${describeInputs(inputArcs)} -> ${describeSide(produces)}`,
        inputArcs,
        consumes,
        produces,
        deltas: netDeltas(consumes, produces),
        rate,
        threshold: rate === null ? null : Math.exp(-rate * options.dt),
        rateCode: parsed(
          typeof transition.rate === "string" ? transition.rate : undefined,
          "rate",
          parse,
          item,
          errors,
        ),
        guard: parsed(transition.guard, "guard", parse, item, errors),
        kernel: parsed(transition.kernel, "kernel", parse, item, errors),
        controllable: transition.controllable === true,
        conflicting: conflicting.has(name),
      };
    },
  );
  const capped = new Map(
    places.flatMap((place) =>
      place.capacity !== undefined &&
      transitions.some((transition) => (transition.deltas.get(place.name) ?? 0) > 0)
        ? [[place.name, place.capacity] as const]
        : [],
    ),
  );
  return {
    name: ir.name,
    facts: netFacts(ir, options),
    kind: ir.kind,
    options,
    places,
    layouts,
    capped,
    transitions,
  };
}
