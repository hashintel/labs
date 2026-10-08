import { describe, expect, it } from "vitest";

import { DEFAULT_EXAMPLE, exampleById } from "../../examples/catalog";
import { documentOf, isChanged, withBlankRule, withConstraintText, withIrText } from "./document";

describe("the document", () => {
  it("opens as the example, unchanged", () => {
    // GIVEN the default example
    // WHEN its document is opened
    const document = documentOf(DEFAULT_EXAMPLE);
    // THEN it holds the example's two texts and differs from nothing
    expect(document).toEqual({
      exampleId: DEFAULT_EXAMPLE.id,
      irText: DEFAULT_EXAMPLE.ir,
      constraintText: DEFAULT_EXAMPLE.constraint,
    });
    expect(isChanged(document, documentOf(DEFAULT_EXAMPLE))).toBe(false);
  });

  it("counts an edit to either text as a change, and the same text as none", () => {
    // GIVEN the opened document
    const opening = documentOf(DEFAULT_EXAMPLE);
    // WHEN each text is edited, and one is set to what it already holds
    const ir = withIrText(opening, `${opening.irText}\n`);
    const constraint = withConstraintText(opening, `${opening.constraintText}\n`);
    const same = withIrText(opening, opening.irText);
    // THEN the edits are changes, and the same text hands back the same document
    expect(isChanged(ir, opening)).toBe(true);
    expect(isChanged(constraint, opening)).toBe(true);
    expect(same).toBe(opening);
  });
});

describe("the blank rule", () => {
  it("replaces only the constraint with an empty always", () => {
    // GIVEN an opened document, of an example that has a rule
    const opening = documentOf(exampleById("queue-always") ?? DEFAULT_EXAMPLE);
    // WHEN its rule is blanked
    const blank = withBlankRule(opening);
    // THEN the net and the other entries stay, the constraint line is always (_), and a second blanking changes nothing
    expect(blank.irText).toBe(opening.irText);
    expect(blank.constraintText).toMatch(/^constraint: always \(_\)$/mu);
    expect(blank.constraintText).not.toBe(opening.constraintText);
    expect(blank.constraintText.replace(/^constraint:.*$/mu, "")).toBe(opening.constraintText.replace(/^constraint:.*$/mu, ""));
    expect(withBlankRule(blank)).toBe(blank);
  });
});
