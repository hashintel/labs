import { describe, expect, it } from "vitest";

import { parsePetriNetIr } from "../compiler";
import { evaluate, parseConstraintDocument, simulate } from "../constraints";
import { EXAMPLES } from "./catalog";

describe("every example with a declared verdict", () => {
  for (const example of EXAMPLES.filter((candidate) => candidate.expect !== undefined)) {
    it(`${example.id} reaches the verdict its meta.ts declares`, () => {
      // GIVEN the example's net and constraint
      const net = parsePetriNetIr(example.ir);
      const parsed = parseConstraintDocument(example.constraint, { mtl: example.mtl === true, nested: example.nested === true });
      if (!net.ok || parsed.doc === undefined) {
        throw new Error(`${example.id} does not parse`);
      }
      // WHEN the run is simulated and evaluated
      const run = simulate(net.ir, parsed.doc.run);
      const evaluation = evaluate(parsed.doc, run.states, { stopReason: run.stopReason });
      // THEN the final verdict and the step that decides it match the declaration
      expect(evaluation.finalVerdict).toBe(example.expect?.verdict);
      if (example.expect?.decidedAt !== undefined) {
        expect(evaluation.decidedAt ?? "end").toBe(example.expect.decidedAt);
      }
    });
  }

  it("leaves only the seed-dependent examples without a declared verdict", () => {
    // GIVEN the examples that declare no verdict
    const undeclared = EXAMPLES.filter((candidate) => candidate.expect === undefined).map((candidate) => candidate.id);
    // THEN they are the ones whose run is a race, where the seed changes the verdict, and the sandbox, whose blank rule has none
    expect(undeclared.toSorted()).toEqual(["machine-until", "order-ship-window", "queue-always", "sandbox"]);
  });
});
