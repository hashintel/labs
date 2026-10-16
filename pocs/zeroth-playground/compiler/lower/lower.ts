import { clocks } from "./clocks";
import { modular } from "./modular";
import { monolithic } from "./monolithic";
import { planStep } from "./step-plan";

import type { CodeParser } from "../code/code-tree";
import type { Diagnostic } from "../diagnostics";
import type { ModuleGraph } from "../graph/module-graph";
import type { PetriNetIr } from "../ir/schema";
import type { ResolvedOptions } from "../options";
import type { Lowering } from "./lowering";

/**
 * Lowers a Petri net IR to a module graph in the shape the options ask
 * for: a reactive module graph in a linear theory under coin rates, an
 * SPN module graph under clock rates. The graph carries no target syntax;
 * an emitter turns it into a file. A construct the lowering cannot express
 * is refused per item, with the IR left intact for the reader.
 */

export type LowerPetriNetIrOutcome =
  | { ok: true; graph: ModuleGraph }
  | { ok: false; errors: Diagnostic[] };

function loweringFor(options: ResolvedOptions): Lowering {
  return options.rates === "clock" ? clocks : options.shape === "modular" ? modular : monolithic;
}

/**
 * `options` are the options in force, each one that does not apply to the
 * net already at its default. `parseCode` reads the document's code strings
 * back into code trees. Without one, a document that carries code is
 * refused with `code-not-parsed`.
 *
 * The lowering refuses what it cannot express before the step is planned,
 * so a net its `refusals` reject has no code read and no refusals of code.
 */
export function lowerPetriNetIr(
  ir: PetriNetIr,
  options: ResolvedOptions,
  parseCode?: CodeParser,
): LowerPetriNetIrOutcome {
  const lowering = loweringFor(options);
  const refused = lowering.refusals(ir);
  if (refused.length > 0) {
    return { ok: false, errors: refused };
  }
  const errors: Diagnostic[] = [];
  const plan = planStep(ir, options, parseCode, errors);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const graph = lowering.lower(plan, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, graph };
}
