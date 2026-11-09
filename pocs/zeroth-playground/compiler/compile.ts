import { emitPython } from "./emit/emit";
import { parsePetriNetIr } from "./ir/parse";
import { lowerPetriNetIr } from "./lower/lower";
import { droppedOptions, optionsForNet, resolveOptions } from "./options";
import { firstLineOf } from "./trace/provenance";
import { traceIr } from "./trace/trace-ir";

import type { Diagnostic } from "./diagnostics";
import type { CompiledFile } from "./emit/python";
import type { PetriNetIr } from "./ir/schema";
import type { ModuleGraph } from "./graph/module-graph";
import type { CodeParser } from "./code/code-tree";
import type { CompilerOptions, ResolvedOptions } from "./options";
import type { Trace } from "./trace/provenance";

export type CompileSettings = {
  /**
   * The options asked for; the document carries none. One that does not
   * apply to the net is dropped with an `option-not-applicable` warning.
   */
  options?: CompilerOptions;
  /**
   * Reads the document's code strings back into code trees. Without one, a
   * net with code strings is refused with `code-not-parsed`.
   */
  parseCode?: CodeParser;
};

export type Compilation = {
  /** The document the text parses to, or `null` when it is not an IR. */
  ir: PetriNetIr | null;
  /** The options in force: those asked for that apply to the net, the defaults for the rest. */
  options: ResolvedOptions;
  /** The trace over the IR text; empty without a document. */
  irTrace: Trace;
  /** `null` when parsing or lowering refuses. */
  graph: ModuleGraph | null;
  /** `net.py` first; empty when refused. */
  files: CompiledFile[];
  /** Each with its IR line when one is found. */
  errors: Diagnostic[];
  warnings: Diagnostic[];
};

/** Each diagnostic at the first IR line of its item, when the trace has one. */
function located(diagnostics: readonly Diagnostic[], irTrace: Trace): Diagnostic[] {
  return diagnostics.map((diagnostic) => {
    const line = firstLineOf(irTrace, diagnostic.item);
    return line === undefined ? diagnostic : { ...diagnostic, line };
  });
}

/** The whole pipeline over one IR text: parse, keep the options that apply, trace, lower, emit. */
export function compile(text: string, { options, parseCode }: CompileSettings = {}): Compilation {
  const parsed = parsePetriNetIr(text);
  if (!parsed.ok) {
    return {
      ir: null,
      options: resolveOptions(options),
      irTrace: [],
      graph: null,
      files: [],
      errors: parsed.errors,
      warnings: [],
    };
  }
  const { ir } = parsed;
  const inForce = resolveOptions(optionsForNet(options, ir));
  const irTrace = traceIr(ir, text, inForce);
  const read = {
    ir,
    options: inForce,
    irTrace,
    warnings: located(droppedOptions(options, ir), irTrace),
  };
  const lowered = lowerPetriNetIr(ir, inForce, parseCode);
  return lowered.ok
    ? {
        ...read,
        graph: lowered.graph,
        files: emitPython(lowered.graph, inForce.layout, ir),
        errors: [],
      }
    : { ...read, graph: null, files: [], errors: located(lowered.errors, irTrace) };
}
