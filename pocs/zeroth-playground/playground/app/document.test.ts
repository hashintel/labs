import { describe, expect, it } from "vitest";

import { parsePetriNetIr } from "../../compiler";
import { exampleById } from "../../examples/catalog";
import { editFile, toggleEditing } from "../playground-view/module-edits";
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
    // THEN it holds the example's text and options, no edits, and counts as unchanged
    expect(document).toEqual({
      exampleId: "birth-death",
      irText: birthDeath.ir,
      options: birthDeath.options,
      module: { editing: false, texts: {} },
    });
    expect(isChanged(document, documentOf(birthDeath))).toBe(false);
  });

  it("drops the module edits on a new text, and keeps the document on the same text", () => {
    // GIVEN Birth–death with a hand edit to net.py
    const edited = {
      ...documentOf(birthDeath),
      module: editFile(toggleEditing(documentOf(birthDeath).module), "net.py", "# edited", "# compiled"),
    };
    // WHEN the same text, then a new one, comes in
    const same = withIrText(edited, birthDeath.ir);
    const changed = withIrText(edited, `${birthDeath.ir}\n`);
    // THEN the same text changes nothing; a new one drops the edits, keeps the toggle, and counts as a change
    expect(same).toBe(edited);
    expect(changed.module).toEqual({ editing: true, texts: {} });
    expect(isChanged(edited, documentOf(birthDeath))).toBe(true);
    expect(isChanged(changed, documentOf(birthDeath))).toBe(true);
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
