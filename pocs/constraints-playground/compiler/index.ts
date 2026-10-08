/**
 * The Petri net IR's public API: the only module the playground and the
 * examples import from this folder. Everything else in compiler/ is internal.
 */

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
export type { ParseOutcome } from "./ir/parse";
export { arcKind, arcWeight, conflictingTransitions, initialTokens } from "./ir/accessors";
export { yamlKeys } from "./ir/yaml-keys";
export type { YamlKey } from "./ir/yaml-keys";
export { itemLabel, sameItem } from "./ir/net-item";
export type { NetItem } from "./ir/net-item";

export { DIAGNOSTIC_CODES } from "./diagnostics";
export type { Diagnostic, DiagnosticCode } from "./diagnostics";
