import { describe, expect, it } from "vitest";

import { parsePetriNetIr } from "../../compiler";
import { exampleById } from "../../examples/catalog";
import { editFile, toggleEditing } from "../examples-view/module-edits";
import { documentOf, isChanged, withIrText, withOptionText } from "./document";

import type { Example } from "../../examples/catalog";

function example(id: string): Example {
  const found = exampleById(id);
  if (found === undefined) {
    throw new Error(`no example ${id}`);
  }
  return found;
}

const queue = example("queue");

describe("the document", () => {
  it("opens as the example, unchanged", () => {
    // GIVEN the queue
    // WHEN its document is opened
    const document = documentOf(queue);
    // THEN it holds the example's text and options, no edits, and counts as unchanged
    expect(document).toEqual({
      exampleId: "queue",
      irText: queue.ir,
      options: queue.options,
      module: { editing: false, texts: {} },
    });
    expect(isChanged(document, queue)).toBe(false);
  });

  it("drops the module edits on a new text, and keeps the document on the same text", () => {
    // GIVEN the queue with a hand edit to net.py
    const edited = {
      ...documentOf(queue),
      module: editFile(toggleEditing(documentOf(queue).module), "net.py", "# edited", "# compiled"),
    };
    // WHEN the same text, then a new one, comes in
    const same = withIrText(edited, queue.ir);
    const changed = withIrText(edited, `${queue.ir}\n`);
    // THEN the same text changes nothing; a new one drops the edits, keeps the toggle, and counts as a change
    expect(same).toBe(edited);
    expect(changed.module).toEqual({ editing: true, texts: {} });
    expect(isChanged(edited, queue)).toBe(true);
    expect(isChanged(changed, queue)).toBe(true);
  });

  it("stores an option the panel changes, and counts the default back as unchanged", () => {
    // GIVEN the queue, which opens modular
    const parsed = parsePetriNetIr(queue.ir);
    if (!parsed.ok) {
      throw new Error("queue does not parse");
    }
    const document = documentOf(queue);
    // WHEN the shape goes to monolithic, then back to modular
    const monolithic = withOptionText(document, parsed.ir, "shape", "monolithic");
    const back = withOptionText(monolithic, parsed.ir, "shape", "modular");
    // THEN the first is a change and the second is not
    expect(isChanged(monolithic, queue)).toBe(true);
    expect(isChanged(back, queue)).toBe(false);
  });
});
