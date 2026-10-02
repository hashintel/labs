import { type ModuleEdits, NO_EDITS, isEdited, recompiled } from "../examples-view/module-edits";
import { sameOptions, withOption } from "../options/option-edits";

import type { CompilerOptions, OptionName, PetriNetIr } from "../../compiler";
import type { Example } from "../../examples/catalog";

/**
 * What the playground has open: the IR text and the compiler options beside
 * it, since the text carries no options. The example it was loaded from
 * names the page. The module edits ride along: a new IR text or new options
 * compile a new module and drop them.
 */
export type Document = {
  exampleId: string;
  irText: string;
  options: CompilerOptions;
  module: ModuleEdits;
};

/** The example as it opens. */
export function documentOf(example: Example): Document {
  return {
    exampleId: example.id,
    irText: example.ir,
    options: example.options,
    module: NO_EDITS,
  };
}

/** Whether the text, the options or the module differ from the example as it opens. */
export function isChanged(document: Document, example: Example): boolean {
  return (
    document.irText !== example.ir ||
    !sameOptions(document.options, example.options) ||
    isEdited(document.module)
  );
}

/** The document with a new IR text, which drops the module edits; the same text keeps it as it is. */
export function withIrText(document: Document, irText: string): Document {
  return irText === document.irText
    ? document
    : { ...document, irText, module: recompiled(document.module) };
}

/** The document with one option changed from a control's text, which drops the module edits. */
export function withOptionText(
  document: Document,
  ir: PetriNetIr,
  name: OptionName,
  text: string,
): Document {
  return {
    ...document,
    options: withOption(ir, document.options, name, text),
    module: recompiled(document.module),
  };
}
