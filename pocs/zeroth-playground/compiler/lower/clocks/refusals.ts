import { arcWeight } from "../../ir/accessors";

import type { Diagnostic } from "../../diagnostics";
import type { PetriNetIr, PetriNetIrArcs } from "../../ir/schema";

/** The arcs of one side that carry more than one token, each as a clause. */
function heavyArcs(arcs: PetriNetIrArcs | undefined, side: "from" | "into"): string[] {
  return Object.entries(arcs ?? {})
    .filter(([, arc]) => arcWeight(arc) > 1)
    .map(([place, arc]) => `the arc ${side} ${place} carries ${arcWeight(arc)}`);
}

/**
 * What the clocks strategy cannot express: it arms a clock with a constant
 * positive rate, fires on the clock and the input arcs alone, counts plain
 * tokens in Nat, tests a count against zero only and moves one token per
 * arc.
 */
export function clockRefusals(ir: PetriNetIr): Diagnostic[] {
  const errors: Diagnostic[] = [];
  for (const [name, place] of Object.entries(ir.places)) {
    const item = { kind: "place" as const, name };
    if (place?.capacity !== undefined) {
      errors.push({
        code: "clocks-capacity",
        message:
          "the clocks strategy cannot test a capacity: the SPN theory tests a count against zero only",
        item,
      });
    }
  }
  for (const [name, transition] of Object.entries(ir.transitions)) {
    const item = { kind: "transition" as const, name };
    if (transition.rate === undefined) {
      errors.push({
        code: "clocks-plain-transition",
        message:
          "the clocks strategy arms a clock at the transition's rate, and this transition has none",
        item,
      });
    } else if (typeof transition.rate === "string") {
      errors.push({
        code: "clocks-rate-code",
        message:
          "the clocks strategy arms a clock with a constant rate; this rate reads its tokens",
        item,
      });
    } else if (!(Number.isFinite(transition.rate) && transition.rate > 0)) {
      errors.push({
        code: "clocks-rate-not-positive",
        message: `the clocks strategy arms a clock with a positive rate; the rate is ${transition.rate}`,
        item,
      });
    }
    if (transition.guard !== undefined) {
      errors.push({
        code: "clocks-guard",
        message:
          "the clocks strategy fires on its clock and its arcs alone; this transition also has a guard",
        item,
      });
    }
    if (transition.kernel !== undefined) {
      errors.push({
        code: "clocks-kernel",
        message: "the clocks strategy moves plain tokens; this transition has a kernel",
        item,
      });
    }
    const heavy = [
      ...heavyArcs(transition.inputs, "from"),
      ...heavyArcs(transition.outputs, "into"),
    ];
    if (heavy.length > 0) {
      errors.push({
        code: "clocks-arc-weight",
        message: `the clocks strategy moves one token per arc; ${heavy.join(", ")}`,
        item,
      });
    }
  }
  return errors;
}
