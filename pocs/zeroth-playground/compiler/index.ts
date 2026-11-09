/**
 * The compiler's public API: the only module the playground and the examples
 * import. Everything else in compiler/ is internal.
 */

// The pipeline
export { compile } from "./compile";
export type { Compilation, CompileSettings } from "./compile";
export type { CompiledFile } from "./emit/python";

// The IR
export { petriNetIrSchema } from "./ir/schema";
export type {
  PetriNetIr,
  PetriNetIrArc,
  PetriNetIrColour,
  PetriNetIrPlace,
  PetriNetIrToken,
  PetriNetIrTransition,
} from "./ir/schema";
export { parsePetriNetIr } from "./ir/parse";
export { arcKind, arcWeight, conflictingTransitions, initialTokens } from "./ir/accessors";
export { yamlKeys } from "./ir/yaml-keys";
export type { YamlKey } from "./ir/yaml-keys";
export { itemLabel, sameItem } from "./ir/net-item";
export type { NetItem } from "./ir/net-item";

// Options
export { OPTIONS, OPTION_NAMES, optionStates, optionsForNet, resolveOptions } from "./options";
export type {
  CompilerOptions,
  NetFacts,
  OptionName,
  OptionSpec,
  OptionState,
  ResolvedOptions,
} from "./options";

// Diagnostics
export { DIAGNOSTIC_CODES } from "./diagnostics";
export type { Diagnostic, DiagnosticCode } from "./diagnostics";

// Traces
export { linesOfItem, matchingLines, provenanceAt } from "./trace/provenance";
export type { LineRange, Provenance, Trace, TraceRange } from "./trace/provenance";

// The module graph, for readers such as the Compiler view
export type { ModuleGraph } from "./graph/module-graph";
export type {
  LinearExpr,
  LinearGraph,
  LinearModule,
  LinearVariable,
  Theory,
} from "./graph/linear-graph";
export type { SpnExpr, SpnGraph, SpnModule, SpnVariable } from "./graph/spn-graph";

// The code-parser hook
export type { CodeExpr, CodeFunction, CodeParser, CodeSurface } from "./code/code-tree";
export { codeStrings } from "./code/code-strings";
export type { CodeString } from "./code/code-strings";
