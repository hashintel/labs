import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

import { parseConstraint, printConstraint, printMath } from "../constraints";
import { EXAMPLES } from "./catalog";

/** Examples whose text is not canonical on purpose: what each one shows. */
const WRITTEN_AS_SHOWN: Readonly<Record<string, string>> = {
  "press-precedence-flat": "and/or mixed without brackets, which the printer brackets",
  "press-not-equals": "not around a bracketed atom, which the printer writes without the brackets",
};

const MATH_EXAMPLE = "press-repair-math";

function constraintText(source: string): string {
  const loaded = load(source) as { constraint: string };
  return loaded.constraint;
}

describe("every example's constraint text", () => {
  for (const example of EXAMPLES) {
    it(`${example.id} is written in its canonical form`, () => {
      // GIVEN the constraint text from the example's constraint.yaml
      const text = constraintText(example.constraint);

      // WHEN it is parsed and printed again, in math notation for the math example
      const { constraint } = parseConstraint(text, { mtl: true, nested: true });
      if (constraint === undefined) {
        throw new Error(`${example.id} does not parse`);
      }
      const printed = example.id === MATH_EXAMPLE ? printMath(constraint) : printConstraint(constraint);

      // THEN the file holds the printed text, except where the example shows a non-canonical form on purpose
      if (WRITTEN_AS_SHOWN[example.id] === undefined) {
        expect(printed).toBe(text);
      } else {
        expect(printed).not.toBe(text);
        expect(parseConstraint(printed, { mtl: true, nested: true }).constraint).toEqual(constraint);
      }
    });
  }
});
