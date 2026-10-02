import type { LinearGraph } from "./linear-graph";
import type { SpnGraph } from "./spn-graph";

/** What a lowering produces: the graph of a linear theory, or of the SPN theory. */
export type ModuleGraph = LinearGraph | SpnGraph;
