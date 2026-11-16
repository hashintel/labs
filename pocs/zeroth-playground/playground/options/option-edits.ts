import { OPTIONS, OPTION_NAMES, optionsForNet, resolveOptions } from "../../compiler";

import type { CompilerOptions, OptionName, PetriNetIr } from "../../compiler";

/**
 * The panel's edits to the options it holds. Its controls give strings, and
 * it stores only the options that bear on the net: those that apply and
 * are off their default.
 */

/** The value a control's text stands for, or `undefined` when it is none of the option's values. */
function valueOf(name: OptionName, text: string): string | number | undefined {
  const values: readonly string[] | null = OPTIONS[name].values;
  if (values !== null) {
    return values.includes(text) ? text : undefined;
  }
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/**
 * The options with one changed, as the panel stores them. A number option
 * whose text does not read as a positive number keeps its value.
 */
export function withOption(
  ir: PetriNetIr,
  options: CompilerOptions,
  name: OptionName,
  text: string,
): CompilerOptions {
  const value = valueOf(name, text);
  const asked = value === undefined ? options : ({ ...options, [name]: value } as CompilerOptions);
  return optionsForNet(asked, ir);
}

/** Whether two option sets compile alike: every option resolves to the same value, defaults included. */
export function sameOptions(a: CompilerOptions, b: CompilerOptions): boolean {
  const left = resolveOptions(a);
  const right = resolveOptions(b);
  return OPTION_NAMES.every((name) => left[name] === right[name]);
}
