import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import mapping from "../compiler/mapping.md?raw";
import { folderOf } from "../examples/catalog";
import { QUESTIONS, questionById } from "./register";

const examplesDir = path.resolve(import.meta.dirname, "../examples");
const referenced = readdirSync(examplesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(path.join(examplesDir, entry.name, "page.mdx")))
  .flatMap((entry) => Array.from(
    readFileSync(path.join(examplesDir, entry.name, "page.mdx"), "utf8").matchAll(/<Question id="([^"]+)"/gu),
    (match) => match[1] ?? "",
  ));
const linked = Array.from(mapping.matchAll(/\]\(\.\.\/semantics\/([^/)]+)\/page\.mdx\)/gu), (match) => match[1] ?? "");

function foldersOf(matches: Record<string, unknown>): string[] {
  return Object.keys(matches).map(folderOf).toSorted();
}

describe("questions for Zeroth", () => {
  it("pair each question's metadata and page", () => {
    // GIVEN the question folders
    const metas = foldersOf(import.meta.glob("./*/meta.ts"));
    // THEN every question has a page and is registered
    expect(foldersOf(import.meta.glob("./*/page.mdx"))).toEqual(metas);
    expect(QUESTIONS.map((question) => question.id).toSorted()).toEqual(metas);
    expect(new Set(QUESTIONS.map((question) => question.order)).size).toBe(QUESTIONS.length);
  });

  it("resolve every reference and link every question", () => {
    // GIVEN references from the example pages and compiler mapping
    const references = [...referenced, ...linked];
    // THEN they resolve and every registered question has a reference
    for (const id of references) expect(questionById(id), id).toBeDefined();
    expect(QUESTIONS.filter((question) => !references.includes(question.id))).toEqual([]);
  });
});
