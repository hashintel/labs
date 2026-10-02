import { describe, expect, it } from "vitest";

import { EXAMPLES, LADDER, folderOf } from "./catalog";

/** The folders a glob matched, sorted. */
function foldersOf(matches: Record<string, unknown>): string[] {
  return Object.keys(matches).map(folderOf).toSorted();
}

describe("the example folders", () => {
  it("each hold a meta.ts, a net.pn.yaml and a page.mdx", () => {
    // GIVEN the folders that hold a meta.ts
    const metas = foldersOf(import.meta.glob("./*/meta.ts"));
    // THEN the same folders hold a net.pn.yaml and a page.mdx, and each is an example
    expect(foldersOf(import.meta.glob("./*/net.pn.yaml"))).toEqual(metas);
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
});
