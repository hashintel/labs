import { describe, expect, it } from "vitest";

import { EXAMPLES, GROUPS, LADDER, folderOf } from "./catalog";

/** The folders a glob matched, sorted. */
function foldersOf(matches: Record<string, unknown>): string[] {
  return Object.keys(matches).map(folderOf).toSorted();
}

describe("the example folders", () => {
  it("each hold a meta.ts, a net.pn.yaml, a constraint.yaml and a page.mdx", () => {
    // GIVEN the folders that hold a meta.ts
    const metas = foldersOf(import.meta.glob("./*/meta.ts"));
    // THEN the same folders hold a net.pn.yaml, a constraint.yaml and a page.mdx, and each is an example
    expect(foldersOf(import.meta.glob("./*/net.pn.yaml"))).toEqual(metas);
    expect(foldersOf(import.meta.glob("./*/constraint.yaml"))).toEqual(metas);
    expect(foldersOf(import.meta.glob("./*/page.mdx"))).toEqual(metas);
    expect(EXAMPLES.map((example) => example.id).toSorted()).toEqual(metas);
  });

  it("climb the ladder rung by rung, each at its own place", () => {
    // GIVEN the examples in their order
    const rungs = LADDER.map((rung) => rung.id);
    // WHEN each is placed on its rung
    const placed = EXAMPLES.map((example) => rungs.indexOf(example.rung));
    // THEN the rungs never go down, and no two examples share an order
    expect(placed).toEqual(placed.toSorted((a, b) => a - b));
    expect(new Set(EXAMPLES.map((example) => example.order)).size).toBe(EXAMPLES.length);
  });

  it("each name a short question, a context, a known group and whether the team must answer it", () => {
    // GIVEN the picker's groups
    const groups = new Set(GROUPS.map((group) => group.id));
    // THEN every example has a question of at most 11 words (symbols do not count), a context of 1 or 2 sentences, a known group and a teamQuestion flag
    for (const example of EXAMPLES) {
      expect(example.question.trim().length, example.id).toBeGreaterThan(0);
      expect(example.question.split(/\s+/).filter((word) => /\w/.test(word)).length, example.id).toBeLessThanOrEqual(11);
      expect(example.context.trim().length, example.id).toBeGreaterThan(0);
      expect(example.context.split(/[.!?](?:\s|$)/u).filter((sentence) => sentence.trim() !== "").length, example.id).toBeLessThanOrEqual(2);
      expect(groups.has(example.group), example.id).toBe(true);
      expect(typeof example.teamQuestion, example.id).toBe("boolean");
    }
    // THEN only the sandbox sits in the sandbox group
    expect(EXAMPLES.filter((example) => example.group === "sandbox").map((example) => example.id)).toEqual(["sandbox"]);
  });
});
