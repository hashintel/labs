import { describe, expect, it } from "vitest";

import { EXAMPLES, folderOf } from "./catalog";

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

  it("give each example its own order", () => {
    // GIVEN the examples in presentation order
    // THEN each order occurs once
    expect(new Set(EXAMPLES.map((example) => example.order)).size).toBe(EXAMPLES.length);
  });
});
