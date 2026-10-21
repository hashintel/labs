import { OPTIONS, optionStates, optionsForNet } from "../index";

import type { CompilerOptions, OptionName, PetriNetIr } from "../index";

/**
 * The option sets the zrth check compiles a net under: the ones it opens
 * with, then each value of a swept option changed alone, then the
 * combinations below. A set is kept only when every option it changes
 * applies to the net, and it is written as the options in force, so two
 * sets that compile alike appear once.
 */

/** The options whose values change the Python's shape, each tried alone. */
export const SWEPT_OPTIONS: readonly OptionName[] = [
  "rates",
  "shape",
  "conflicts",
  "marking",
  "control",
  "layout",
];

/** Changes tried together, because one value only shows its output beside the other. */
export const COMBINED_CHANGES: readonly CompilerOptions[] = [
  { rates: "clock", conflicts: "nondet" },
];

function appliesAll(ir: PetriNetIr, options: CompilerOptions, changed: readonly string[]): boolean {
  return optionStates(ir, options).every(
    ({ name, notApplicable }) => !changed.includes(name) || notApplicable === undefined,
  );
}

function sweptChanges(): CompilerOptions[] {
  return SWEPT_OPTIONS.flatMap((name) =>
    (OPTIONS[name].values ?? []).map((value): CompilerOptions => ({ [name]: value })),
  );
}

/** The opening options first, then every applicable change, each as the options in force. */
export function optionVariants(ir: PetriNetIr, opening: CompilerOptions): CompilerOptions[] {
  const candidates = [
    optionsForNet(opening, ir),
    ...[...sweptChanges(), ...COMBINED_CHANGES]
      .map((change) => ({ change, options: { ...opening, ...change } }))
      .filter(({ change, options }) => appliesAll(ir, options, Object.keys(change)))
      .map(({ options }) => optionsForNet(options, ir)),
  ];
  const seen = new Set<string>();
  return candidates.filter((options) => {
    const key = JSON.stringify(options);
    const fresh = !seen.has(key);
    seen.add(key);
    return fresh;
  });
}

/** `rates=clock, conflicts=nondet`, or `defaults` when every option is at its default. */
export function optionsLabel(options: CompilerOptions): string {
  const entries = Object.entries(options);
  return entries.length === 0
    ? "defaults"
    : entries.map(([name, value]) => `${name}=${value}`).join(", ");
}
