import { sameOptions, withOption } from "../options/option-edits";

import type { CompilerOptions, OptionName, PetriNetIr } from "../../compiler";
import type { Example } from "../../examples/catalog";

export type Document = {
  exampleId: string;
  irText: string;
  options: CompilerOptions;
};

/** The example as it opens, under the options given in place of its own. */
export function documentOf(example: Example, options: CompilerOptions = example.options): Document {
  return {
    exampleId: example.id,
    irText: example.ir,
    options,
  };
}

export function isChanged(document: Document, opening: Document): boolean {
  return (
    document.irText !== opening.irText ||
    !sameOptions(document.options, opening.options)
  );
}

export function withIrText(document: Document, irText: string): Document {
  return irText === document.irText
    ? document
    : { ...document, irText };
}

export function withOptionText(
  document: Document,
  ir: PetriNetIr,
  name: OptionName,
  text: string,
): Document {
  return {
    ...document,
    options: withOption(ir, document.options, name, text),
  };
}
