import { arcKind, arcWeight } from "../ir/accessors";

import type { PetriNetIr } from "../ir/schema";
import type { ResolvedOptions } from "../options";
import type { LinearValue } from "./run-linear-graph";

/**
 * One step of the net over the IR, the oracle the lowerings are checked
 * against: transitions in record order, enablement on the current count,
 * capacity on count plus pending plus the net change, consumption at once,
 * production at the end of the step. A read arc needs its weight and an
 * inhibitor arc fewer; neither moves a token. The options give the step's
 * length and whether a controllable transition waits for its choice.
 */
export function referenceStep(
  ir: PetriNetIr,
  options: ResolvedOptions,
  marking: Record<string, number>,
  inputs: (name: string) => LinearValue,
): Record<string, number> {
  const count = { ...marking };
  const pending: Record<string, number> = {};
  for (const [name, transition] of Object.entries(ir.transitions)) {
    const arcs = Object.entries(transition.inputs ?? {}).map(
      ([place, arc]) => [place, arcWeight(arc), arcKind(arc)] as const,
    );
    const consumes = arcs.filter(([, , kind]) => kind === "standard");
    const produces = Object.entries(transition.outputs ?? {}).map(
      ([place, arc]) => [place, arcWeight(arc)] as const,
    );
    const deltas: Record<string, number> = {};
    for (const [place, weight] of produces) {
      deltas[place] = (deltas[place] ?? 0) + weight;
    }
    for (const [place, weight] of consumes) {
      deltas[place] = (deltas[place] ?? 0) - weight;
    }
    let enabled = arcs.every(([place, weight, kind]) =>
      kind === "inhibitor" ? (count[place] ?? 0) < weight : (count[place] ?? 0) >= weight,
    );
    for (const [place, delta] of Object.entries(deltas)) {
      const capacity = ir.places[place]?.capacity;
      if (delta > 0 && capacity !== undefined) {
        enabled &&= (count[place] ?? 0) + (pending[place] ?? 0) + delta <= capacity;
      }
    }
    if (ir.kind === "stochastic") {
      const draw = inputs(`u_${name}`);
      const rate = typeof transition.rate === "number" ? transition.rate : 0;
      enabled &&= typeof draw === "number" && draw >= Math.exp(-rate * options.dt);
    }
    if (transition.controllable === true && options.control === "open") {
      enabled &&= inputs(`go_${name}`) === true;
    }
    if (!enabled) {
      continue;
    }
    for (const [place, weight] of consumes) {
      count[place] = (count[place] ?? 0) - weight;
    }
    for (const [place, weight] of produces) {
      pending[place] = (pending[place] ?? 0) + weight;
    }
  }
  for (const place of Object.keys(ir.places)) {
    count[place] = (count[place] ?? 0) + (pending[place] ?? 0);
  }
  return count;
}
