import { linearProgram } from "./linear";
import { pythonFiles } from "./python";
import { spnProgram } from "./spn";

import type { ModuleGraph } from "../graph/module-graph";
import type { PetriNetIr } from "../ir/schema";
import type { ResolvedOptions } from "../options";
import type { CompiledFile } from "./python";

/**
 * The graph as Python over `zrth.sugar`, printed in the dialect of its
 * language: `net.py` alone, or under the per-module layout `net.py` first
 * and one file per module. Each file carries its trace, written with it.
 */
export function emitPython(
  graph: ModuleGraph,
  layout: ResolvedOptions["layout"],
  ir: PetriNetIr,
): CompiledFile[] {
  return pythonFiles(
    graph.language === "spn" ? spnProgram(graph) : linearProgram(graph),
    layout,
    ir,
  );
}
