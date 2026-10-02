import { arcWeight, initialTokens } from "../../compiler";

import type { NetItem, PetriNetIr } from "../../compiler";

/**
 * The net as a drawing reads it: one node per place and transition, one
 * edge per arc, and nothing about layout. Pure over the IR, so the preview
 * is a function of the document.
 */

export type PlaceNode = {
  id: string;
  kind: "place";
  name: string;
  tokens: number;
  capacity?: number;
  colour?: string;
};

export type TransitionNode = {
  id: string;
  kind: "transition";
  name: string;
  /** A constant rate, `"code"` for a rate over the tokens, absent for a plain transition. */
  rate?: number | "code";
  guarded: boolean;
  controllable: boolean;
};

export type NetNode = PlaceNode | TransitionNode;

export type NetEdge = {
  id: string;
  /** Node ids; an input arc runs place to transition, an output arc the other way. */
  source: string;
  target: string;
  place: string;
  transition: string;
  weight: number;
  kind: "standard" | "read" | "inhibitor";
};

export type NetGraph = {
  nodes: NetNode[];
  edges: NetEdge[];
};

function placeId(name: string): string {
  return `place:${name}`;
}
function transitionId(name: string): string {
  return `transition:${name}`;
}

/** The net item a node stands for, as the traces name it. */
export function nodeSource(node: NetNode): NetItem {
  return { kind: node.kind, name: node.name };
}

function definedOnly<T extends object>(object: T): T {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  ) as T;
}

export function netGraph(ir: PetriNetIr): NetGraph {
  const places = Object.entries(ir.places).map(
    ([name, place]): PlaceNode =>
      definedOnly({
        id: placeId(name),
        kind: "place",
        name,
        tokens: initialTokens(ir, name),
        capacity: place?.capacity,
        colour: place?.colour,
      }),
  );
  const transitions = Object.entries(ir.transitions).map(
    ([name, transition]): TransitionNode =>
      definedOnly({
        id: transitionId(name),
        kind: "transition",
        name,
        rate:
          transition.rate === undefined
            ? undefined
            : typeof transition.rate === "number"
              ? transition.rate
              : "code",
        guarded: transition.guard !== undefined,
        controllable: transition.controllable === true,
      }),
  );
  const edges = Object.entries(ir.transitions).flatMap(([name, transition]) => [
    ...Object.entries(transition.inputs ?? {}).map(
      ([place, arc]): NetEdge => ({
        id: `${place}->${name}`,
        source: placeId(place),
        target: transitionId(name),
        place,
        transition: name,
        weight: arcWeight(arc),
        kind: arc?.kind ?? "standard",
      }),
    ),
    ...Object.entries(transition.outputs ?? {}).map(
      ([place, arc]): NetEdge => ({
        id: `${name}->${place}`,
        source: transitionId(name),
        target: placeId(place),
        place,
        transition: name,
        weight: arcWeight(arc),
        kind: "standard",
      }),
    ),
  ]);
  const known = new Set([...places, ...transitions].map((node) => node.id));
  return {
    nodes: [...places, ...transitions],
    // An arc to a place the IR does not declare is the lowering's error to report, not a node.
    edges: edges.filter((edge) => known.has(edge.source) && known.has(edge.target)),
  };
}
