import { describe, expect, it } from "vitest";

import { exampleById } from "../../examples/catalog";
import { EVIDENCE_LINES, evidenceOf } from "./evidence";

import type { Example } from "../../examples/catalog";

function example(id: string): Example {
  const found = exampleById(id);
  if (found === undefined) {
    throw new Error(`no example ${id}`);
  }
  return found;
}

describe("evidenceOf", () => {
  it("quotes the lines of the item, numbered as in the file, where the numbers may skip", () => {
    // GIVEN Conflict with rates under clocks and nondet conflicts, and the place Pool
    // WHEN the evidence is read
    const evidence = evidenceOf(example("conflict-clocked"), {
      example: "conflict-clocked",
      options: { rates: "clock", conflicts: "nondet" },
      item: { kind: "place", name: "Pool" },
    });
    // THEN it quotes net.py's lines of the place: its variable, its class and its instance
    if (evidence.kind !== "lines") {
      throw new Error("expected lines");
    }
    expect(evidence.excerpt.source).toBe("net.py · place Pool");
    const numbers = evidence.excerpt.lines.map((line) => line.number);
    expect(numbers[0]).toBe(7);
    expect(evidence.excerpt.lines[0]?.text).toBe("Pool = Var(Nat())");
    expect(numbers).toContain(65);
    expect(numbers.at(-1)).toBe(104);
    expect(evidence.excerpt.lines.every((line) => !line.lit)).toBe(true);
  });

  it("cuts a long quote and says so in the source", () => {
    // GIVEN the same net and the transition TakeRight, which owns more lines than the cap
    // WHEN the evidence is read
    const evidence = evidenceOf(example("conflict-clocked"), {
      example: "conflict-clocked",
      options: { rates: "clock", conflicts: "nondet" },
      item: { kind: "transition", name: "TakeRight" },
    });
    // THEN the first lines up to the cap are quoted, and the source counts the rest
    if (evidence.kind !== "lines") {
      throw new Error("expected lines");
    }
    expect(evidence.excerpt.lines).toHaveLength(EVIDENCE_LINES);
    expect(evidence.excerpt.source).toMatch(/^net\.py · transition TakeRight · first 14 of \d+ lines$/u);
  });

  it("quotes the opening lines of the file without an item", () => {
    // GIVEN Cycle under its defaults, with no item named
    // WHEN the evidence is read
    const evidence = evidenceOf(example("cycle"), { example: "cycle" });
    // THEN the first lines of net.py are quoted from line 1
    expect(evidence).toMatchObject({ kind: "lines", excerpt: { source: "net.py · first 12 lines" } });
    if (evidence.kind === "lines") {
      expect(evidence.excerpt.lines.map((line) => line.number)).toEqual(
        Array.from({ length: 12 }, (_, index) => index + 1),
      );
    }
  });

  it("quotes the first diagnostic when the compile refuses", () => {
    // GIVEN Bucket under the modular shape, which the lowering refuses
    // WHEN the evidence is read
    const evidence = evidenceOf(example("bucket"), { example: "bucket", options: { shape: "modular" } });
    // THEN the refusal's code and message stand in for the lines
    expect(evidence.kind).toBe("refused");
    if (evidence.kind === "refused") {
      expect(evidence.message).toMatch(/^modular-coloured-not-lowered: /u);
    }
  });
});
