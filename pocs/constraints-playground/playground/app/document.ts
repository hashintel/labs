import { printConstraint } from "../../constraints";
import { withConstraintLine } from "../constraint-panel/constraint-text";

import type { Example } from "../../examples/catalog";

/**
 * What the playground has open: the net IR text and the constraint file's
 * text. The example it was loaded from names the page.
 */
export type Document = {
  exampleId: string;
  irText: string;
  constraintText: string;
};

/** The example as it opens. */
export function documentOf(example: Example): Document {
  return { exampleId: example.id, irText: example.ir, constraintText: example.constraint };
}

/** The document with its constraint replaced by `always (_)`, a hole. The net, the metrics and the run settings stay. */
export function withBlankRule(document: Document): Document {
  return withConstraintText(document, withConstraintLine(document.constraintText, printConstraint({ op: "always", body: { kind: "hole" } })));
}

/** Whether either text differs from the document as it opened. */
export function isChanged(document: Document, opening: Document): boolean {
  return document.irText !== opening.irText || document.constraintText !== opening.constraintText;
}

/** The document with a new IR text. */
export function withIrText(document: Document, irText: string): Document {
  return irText === document.irText ? document : { ...document, irText };
}

/** The document with a new constraint text. */
export function withConstraintText(document: Document, constraintText: string): Document {
  return constraintText === document.constraintText ? document : { ...document, constraintText };
}
