import { describe, expect, it } from "vitest";

import { parsePetriNetIr } from "../compiler";
import {
  NESTED_NEEDS_LTL_ERROR,
  WINDOW_NEEDS_MTL_ERROR,
  checkReferences,
  evaluate,
  hasErrors,
  parseConstraintDocument,
  simulate,
} from "../constraints";
import { EXAMPLES } from "./catalog";

describe("every example", () => {
  for (const example of EXAMPLES) {
    it(`${example.id} parses, checks against its net and runs`, () => {
      // GIVEN the example's net and constraint texts
      const net = parsePetriNetIr(example.ir);
      const parsed = parseConstraintDocument(example.constraint, { mtl: example.mtl === true, nested: example.nested === true });
      // WHEN the net and the constraint parse, the references are checked and the run is evaluated
      expect(net.ok).toBe(true);
      if (!net.ok || parsed.doc === undefined) {
        throw new Error(`${example.id} does not parse`);
      }
      const references = checkReferences(parsed.doc, net.ir, parsed.lines);
      const run = simulate(net.ir, parsed.doc.run);
      const evaluation = evaluate(parsed.doc, run.states, { stopReason: run.stopReason });
      // THEN no step reports an error but the one the meta.ts expects, which must appear, and the verdict is decided by the end of the run, except the sandbox's blank rule
      const expected = example.expectsDiagnostic;
      const reported = [...parsed.diagnostics, ...references, ...run.diagnostics, ...evaluation.diagnostics];
      if (expected === undefined) {
        expect(hasErrors(reported)).toBe(false);
      } else {
        expect(reported.map((diagnostic) => diagnostic.message)).toContain(expected);
        expect(hasErrors(reported.filter((diagnostic) => diagnostic.message !== expected))).toBe(false);
      }
      // The sandbox opens on a blank rule, which stays pending.
      if (example.id === "sandbox") {
        expect(evaluation.finalVerdict).toBe("pending");
      } else {
        expect(evaluation.finalVerdict).not.toBe("pending");
      }
    });
  }
});

describe("the mtl flag of the examples", () => {
  for (const example of EXAMPLES) {
    it(`${example.id} is flagged mtl exactly when its constraint has a window`, () => {
      // GIVEN the example's constraint file
      // WHEN it is parsed with MTL off and nested operators on
      const off = parseConstraintDocument(example.constraint, { mtl: false, nested: true });
      // THEN it fails with the window error exactly for the examples flagged mtl, which sit on the mtl rung
      const needsMtl = off.diagnostics.some((diagnostic) => diagnostic.message === WINDOW_NEEDS_MTL_ERROR);
      expect(needsMtl).toBe(example.mtl === true);
      expect(example.rung === "mtl").toBe(example.mtl === true);
    });
  }
});

describe("the nested flag of the examples", () => {
  for (const example of EXAMPLES) {
    it(`${example.id} is flagged nested exactly when its constraint nests an operator`, () => {
      // GIVEN the example's constraint file
      // WHEN it is parsed with nested off and MTL on
      const off = parseConstraintDocument(example.constraint, { mtl: true, nested: false });
      // THEN it fails with the nested error exactly for the examples flagged nested, and a nested-only example sits on the nested rung
      const needsNested = off.diagnostics.some((diagnostic) => diagnostic.message === NESTED_NEEDS_LTL_ERROR);
      expect(needsNested).toBe(example.nested === true);
      if (example.nested === true && example.mtl !== true) {
        expect(example.rung).toBe("nested");
      }
      if (example.rung === "nested") {
        expect(example.nested).toBe(true);
      }
    });
  }
});

describe("the examples listed with both flags off", () => {
  for (const example of EXAMPLES.filter((candidate) => candidate.listed && candidate.mtl !== true && candidate.nested !== true)) {
    it(`${example.id} parses with mtl and nested off`, () => {
      // GIVEN a listed example that declares neither flag, which the picker shows with both flags off
      // WHEN its constraint is parsed with both flags off
      const parsed = parseConstraintDocument(example.constraint, { mtl: false, nested: false });
      // THEN it parses with no error
      expect(hasErrors(parsed.diagnostics)).toBe(false);
      expect(parsed.doc).toBeDefined();
    });
  }

  it("keeps every example that needs a flag on the nested or mtl rung, which the picker hides while its flag is off", () => {
    // GIVEN the examples that declare a flag
    const flagged = EXAMPLES.filter((example) => example.mtl === true || example.nested === true);
    // WHEN their rungs are read
    // THEN each sits on the nested or mtl rung, and none sits elsewhere
    expect(flagged.length).toBeGreaterThan(0);
    for (const example of flagged) {
      expect(["nested", "mtl"]).toContain(example.rung);
    }
    expect(EXAMPLES.filter((example) => !flagged.includes(example)).every((example) => example.rung !== "nested" && example.rung !== "mtl")).toBe(true);
  });
});
