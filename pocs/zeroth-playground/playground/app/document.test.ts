import { describe, expect, it } from "vitest";

import { parsePetriNetIr } from "../../compiler";
import { exampleById } from "../../examples/catalog";
import { documentOf, isChanged, withIrText, withOptionText } from "./document";

import type { Example } from "../../examples/catalog";

function example(id: string): Example {
  const found = exampleById(id);
  if (found === undefined) {
    throw new Error(`no example ${id}`);
  }
  return found;
}

const birthDeath = example("birth-death");

describe("the document", () => {
  it("opens as the example, unchanged", () => {
    // GIVEN Birth–death under coins
    // WHEN its document is opened
    const document = documentOf(birthDeath);
    // THEN it holds the example's text and options, and counts as unchanged
    expect(document).toEqual({
      exampleId: "birth-death",
      irText: birthDeath.ir,
      options: birthDeath.options,
    });
    expect(isChanged(document, documentOf(birthDeath))).toBe(false);
  });

  it("keeps the document for the same text and records a new text", () => {
    // GIVEN an open example
    const document = documentOf(birthDeath);
    // WHEN the same text and a new text arrive
    const same = withIrText(document, birthDeath.ir);
    const changed = withIrText(document, `${birthDeath.ir}\n`);
    // THEN unchanged text preserves identity and new text counts as a change
    expect(same).toBe(document);
    expect(changed.irText).toBe(`${birthDeath.ir}\n`);
    expect(isChanged(changed, document)).toBe(true);
  });

  it("stores an option the panel changes, and counts the default back as unchanged", () => {
    // GIVEN Birth–death, which opens modular
    const parsed = parsePetriNetIr(birthDeath.ir);
    if (!parsed.ok) {
      throw new Error("birth-death does not parse");
    }
    const document = documentOf(birthDeath);
    // WHEN the shape goes to monolithic, then back to modular
    const monolithic = withOptionText(document, parsed.ir, "shape", "monolithic");
    const back = withOptionText(monolithic, parsed.ir, "shape", "modular");
    // THEN the first is a change and the second is not
    expect(isChanged(monolithic, documentOf(birthDeath))).toBe(true);
    expect(isChanged(back, documentOf(birthDeath))).toBe(false);
  });
});
