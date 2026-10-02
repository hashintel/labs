import { arcKind, arcWeight } from "../ir/accessors";

import type { PetriNetIr, PetriNetIrArc } from "../ir/schema";

/** The words for an arc, a transition and a place, shared by the IR and Python traces. */

export function arcText(arc: PetriNetIrArc): string {
  const weight = arcWeight(arc);
  const kind = arcKind(arc);
  const tokens = weight === 1 ? "one token" : `${weight} tokens`;
  return kind === "standard"
    ? tokens
    : kind === "read"
      ? `reads ${tokens} and leaves them`
      : `fires only with fewer than ${weight} token${weight === 1 ? "" : "s"}`;
}

/** What a transition takes and adds, and when it fires. */
export function transitionWhy(ir: PetriNetIr, name: string, clocks: boolean): string {
  const transition = ir.transitions[name];
  if (transition === undefined) {
    return "";
  }
  const inputs = Object.keys(transition.inputs ?? {});
  const outputs = Object.keys(transition.outputs ?? {});
  const parts = [
    inputs.length === 0 ? "takes nothing" : `takes from ${inputs.join(", ")}`,
    outputs.length === 0 ? "adds nothing" : `adds to ${outputs.join(", ")}`,
  ];
  if (transition.rate !== undefined) {
    parts.push(
      typeof transition.rate === "number"
        ? clocks
          ? `fires at rate ${transition.rate}, a clock armed with exp(${transition.rate}) each time it fires`
          : `fires at rate ${transition.rate}, tested over dt each step`
        : "fires at a rate its tokens decide, tested over dt each step",
    );
  } else if (transition.guard !== undefined) {
    parts.push("fires when enabled and its guard holds");
  } else {
    parts.push("fires whenever enabled");
  }
  if (transition.controllable === true) {
    parts.push("controllable");
  }
  return `${parts.join("; ")}.`;
}

/** What a place starts with, holds and carries. */
export function placeWhy(ir: PetriNetIr, name: string): string {
  const place = ir.places[name];
  const parts: string[] = [];
  const initial = ir.marking?.[name];
  if (initial !== undefined) {
    parts.push(
      typeof initial === "number"
        ? `starts with ${initial} token${initial === 1 ? "" : "s"}`
        : `starts with ${initial.length} token${initial.length === 1 ? "" : "s"}`,
    );
  } else {
    parts.push("starts empty");
  }
  if (place?.capacity !== undefined) {
    parts.push(`holds at most ${place.capacity}`);
  }
  if (place?.colour !== undefined) {
    parts.push(`tokens are ${place.colour} records`);
  }
  if (place?.dynamics !== undefined) {
    parts.push(`its tokens move by ${place.dynamics}`);
  }
  return `${parts.join("; ")}.`;
}
