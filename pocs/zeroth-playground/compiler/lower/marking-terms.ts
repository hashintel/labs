import { binary, num, type LinearExpr } from "../graph/linear-graph";

import type { PlannedArc } from "./step-plan";

/**
 * The guard terms that read the marking, shared by both shapes. Each shape
 * passes the token count it computes: the monolithic sweep reads the place
 * as consumed so far, a modular transition rebuilds it from earlier firings.
 */

/** An input arc's test: the place holds at least the weight, or fewer under an inhibitor. */
export function arcTest(arc: PlannedArc, tokens: LinearExpr): LinearExpr {
  return binary(arc.kind === "inhibitor" ? "<" : ">=", tokens, num(arc.weight));
}

/** A producer's room test: the capped place's fill plus the net change stays within the capacity. */
export function roomTest(fill: LinearExpr, delta: number, capacity: number): LinearExpr {
  return binary("<=", binary("+", fill, num(delta)), num(capacity));
}
