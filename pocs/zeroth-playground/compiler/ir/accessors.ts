import type { PetriNetIr, PetriNetIrArc, PetriNetIrTransition } from "./schema";

/** The defaults behind the IR's bare keys, read in one place. */

export function arcWeight(arc: PetriNetIrArc): number {
  return arc?.weight ?? 1;
}

export function arcKind(arc: PetriNetIrArc): "standard" | "read" | "inhibitor" {
  return arc?.kind ?? "standard";
}

/** The tokens a place starts with: its count, or the number of its records. */
export function initialTokens(ir: Pick<PetriNetIr, "marking">, place: string): number {
  const marking = ir.marking?.[place];
  return marking === undefined ? 0 : typeof marking === "number" ? marking : marking.length;
}

/**
 * The transitions in a conflict: each shares an input place with another
 * transition, whatever the arcs' kinds. In record order.
 */
export function conflictingTransitions(
  transitions: Record<string, PetriNetIrTransition>,
): Set<string> {
  const readers = new Map<string, string[]>();
  for (const [name, transition] of Object.entries(transitions)) {
    for (const place of Object.keys(transition.inputs ?? {})) {
      readers.set(place, [...(readers.get(place) ?? []), name]);
    }
  }
  const shared = new Set([...readers.values()].filter((names) => names.length > 1).flat());
  return new Set(Object.keys(transitions).filter((name) => shared.has(name)));
}
