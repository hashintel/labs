import type { Diagnostic } from "../diagnostics";
import type { ModuleGraph } from "../graph/module-graph";
import type { PetriNetIr } from "../ir/schema";
import type { StepPlan } from "./step-plan";

/** One way to turn a net into a module graph: the monolithic, modular or clocks lowering. */
export type Lowering = {
  /** What this lowering cannot express, refused before the step is planned. */
  refusals(ir: PetriNetIr): Diagnostic[];
  /** The graph of a planned step; a construct it cannot express goes to `errors`. */
  lower(plan: StepPlan, errors: Diagnostic[]): ModuleGraph;
};
