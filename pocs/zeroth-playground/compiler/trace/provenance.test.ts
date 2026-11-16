import { describe, expect, it } from "vitest";

import { yaml } from "../testing/compile-net";
import { lineContaining } from "../testing/line-containing";
import { cycle } from "../testing/small-nets.fixtures";
import { compile } from "../compile";
import { linesOfItem, matchingLines, provenanceAt } from "./provenance";

describe("provenanceAt", () => {
  it("returns null off every range", () => {
    // GIVEN an empty trace
    // WHEN a line is looked up
    const provenance = provenanceAt([], 3);
    // THEN there is nothing there
    expect(provenance).toBeNull();
  });
});

describe("matchingLines", () => {
  const irText = yaml(cycle);
  const { irTrace, files } = compile(irText);
  const python = files[0];
  if (python === undefined) {
    throw new Error("the cycle compiles");
  }

  it("pairs ranges by net item first, then by IR path prefix", () => {
    // GIVEN a small trace of four ranges
    const trace = [
      {
        startLine: 1,
        endLine: 1,
        provenance: { what: "a", ir: "marking.A", source: { kind: "place" as const, name: "A" } },
      },
      {
        startLine: 2,
        endLine: 2,
        provenance: { what: "b", source: { kind: "transition" as const, name: "A" } },
      },
      { startLine: 3, endLine: 4, provenance: { what: "c", ir: "places" } },
      { startLine: 4, endLine: 4, provenance: { what: "d", ir: "places.B.capacity" } },
    ];
    // WHEN ranges are matched against a place, a section and another section
    const place = matchingLines(trace, { what: "x", source: { kind: "place", name: "A" } });
    const section = matchingLines(trace, { what: "x", ir: "places.B" });
    const other = matchingLines(trace, { what: "x", ir: "transitions" });
    // THEN a source matches its own item alone, and paths match by prefix among ranges without one
    expect(place).toEqual([{ startLine: 1, endLine: 1 }]);
    expect(section).toEqual([
      { startLine: 3, endLine: 4 },
      { startLine: 4, endLine: 4 },
    ]);
    expect(other).toEqual([]);
  });

  it("lights the transition's Python from a hover on its IR entry", () => {
    // GIVEN a hover on the line of the transition Go in the IR
    const hovered = provenanceAt(irTrace, lineContaining(irText, "  Go:"));
    expect(hovered?.source).toEqual({ kind: "transition", name: "Go" });
    if (hovered === null) {
      return;
    }
    // WHEN the Python lines that match it are found
    const texts = matchingLines(python.trace, hovered).map(({ startLine }) =>
      python.text.split("\n")[startLine - 1]?.trim(),
    );
    // THEN its firing line is among them, and the landing in B belongs to the place
    expect(texts).toContain("fire_Go = A >= 1  # Go: A -> B");
    expect(
      provenanceAt(python.trace, lineContaining(python.text, "B = ite(fire_Go, B + 1, B)"))?.source,
    ).toEqual({
      kind: "place",
      name: "B",
    });
  });

  it("lights the IR lines of a place from its Python variable, as a hover on the place itself would", () => {
    // GIVEN a hover on the Python declaration of A
    const hovered = provenanceAt(python.trace, lineContaining(python.text, "A = Var(INT)"));
    expect(hovered?.source).toEqual({ kind: "place", name: "A" });
    if (hovered === null) {
      return;
    }
    // WHEN the IR lines that match it are found
    const lines = matchingLines(irTrace, hovered);
    // THEN they are the place's own ranges: its entry, its marking and its arcs
    expect(lines.map(({ startLine }) => irText.split("\n")[startLine - 1]?.trim())).toEqual(
      expect.arrayContaining(["A: null", "A: 1"]),
    );
    expect(linesOfItem(irTrace, { kind: "place", name: "A" })).toEqual(lines);
  });
});
