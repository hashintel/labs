import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { compile, optionsForNet, parsePetriNetIr, sameItem } from "../compiler";
import { exampleById, folderOf } from "../examples/catalog";
import mapping from "../compiler/mapping.md?raw";
import { QUESTIONS, TOPICS, questionById, questionsOf } from "./register";

import type { Showing } from "./register";

/** The folders a glob matched, sorted. */
function foldersOf(matches: Record<string, unknown>): string[] {
  return Object.keys(matches).map(folderOf).toSorted();
}

// The pages are read as text, since the MDX plugin compiles a `?raw` import of an .mdx file too.
const EXAMPLES_DIR = path.resolve(import.meta.dirname, "../examples");

/** The ids `<Question id="..." />` names across the example pages. */
const REFERENCED_ON_PAGES = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(path.join(EXAMPLES_DIR, entry.name, "page.mdx")))
  .flatMap((entry) => {
    const text = readFileSync(path.join(EXAMPLES_DIR, entry.name, "page.mdx"), "utf8");
    return Array.from(text.matchAll(/<Question id="([^"]+)"/gu), (match) => match[1] ?? "");
  });

/** The question folders mapping.md links, as `../semantics/<id>/page.mdx`. */
const LINKED_FROM_MAPPING = Array.from(
  mapping.matchAll(/\]\(\.\.\/semantics\/([^/)]+)\/page\.mdx\)/gu),
  (match) => match[1] ?? "",
);

/** Each showing with its example, compiled at its options; throws on an example the catalog lacks. */
function placed(showing: Showing) {
  const example = exampleById(showing.example);
  if (example === undefined) {
    throw new Error(`no example ${showing.example}`);
  }
  const parsed = parsePetriNetIr(example.ir);
  if (!parsed.ok) {
    throw new Error(`${showing.example} does not parse`);
  }
  return { example, ir: parsed.ir, compilation: compile(example.ir, { options: showing.options }) };
}

describe("the question folders", () => {
  it("each hold a meta.ts and a page.mdx, and each is a question", () => {
    // GIVEN the folders that hold a meta.ts
    const metas = foldersOf(import.meta.glob("./*/meta.ts"));
    // THEN the same folders hold a page.mdx, and each is a question
    expect(foldersOf(import.meta.glob("./*/page.mdx"))).toEqual(metas);
    expect(QUESTIONS.map((question) => question.id).toSorted()).toEqual(metas);
  });

  it("have unique ids, and unique orders within a topic", () => {
    // GIVEN every question
    // THEN no id repeats, and no two questions of one topic share an order
    expect(new Set(QUESTIONS.map((question) => question.id)).size).toBe(QUESTIONS.length);
    for (const topic of TOPICS) {
      const orders = questionsOf(topic.id).map((question) => question.order);
      expect(new Set(orders).size, topic.id).toBe(orders.length);
    }
  });

  it("sort by topic in the topics' order, then by order", () => {
    // GIVEN the questions as the register lists them
    const ranks = TOPICS.map((topic) => topic.id);
    // WHEN each is placed by topic
    const placed = QUESTIONS.map((question) => ranks.indexOf(question.topic));
    // THEN the topics never go back, and within a topic the orders rise
    expect(placed).toEqual(placed.toSorted((a, b) => a - b));
    for (const topic of TOPICS) {
      const orders = questionsOf(topic.id).map((question) => question.order);
      expect(orders).toEqual(orders.toSorted((a, b) => a - b));
    }
  });

  it("give every topic at least one question", () => {
    // GIVEN every topic
    // THEN each has a question
    for (const topic of TOPICS) {
      expect(questionsOf(topic.id).length, topic.id).toBeGreaterThan(0);
    }
  });
});

describe("where the questions show", () => {
  const showings = QUESTIONS.flatMap((question) =>
    question.shows.map((showing) => ({ question, showing })),
  );

  it("name an example of the catalog, compiled under options the panel keeps for its net", () => {
    // GIVEN every showing
    for (const { question, showing } of showings) {
      // WHEN its example is compiled at its options
      const { ir } = placed(showing);
      // THEN the options are the ones optionsForNet keeps for that net, so the panel shows them
      expect(optionsForNet(showing.options, ir), `${question.id} on ${showing.example}`).toEqual(
        showing.options ?? {},
      );
    }
  });

  it("name a place, a transition or the net of the example", () => {
    // GIVEN every showing with an item
    for (const { question, showing } of showings) {
      if (showing.item === undefined) {
        continue;
      }
      const { ir } = placed(showing);
      // THEN the item is in the net
      const names =
        showing.item.kind === "place"
          ? Object.keys(ir.places)
          : showing.item.kind === "transition"
            ? Object.keys(ir.transitions)
            : showing.item.kind === "net"
              ? [ir.name]
              : [];
      expect(names, `${question.id} on ${showing.example}`).toContain(showing.item.name);
    }
  });

  it("quote lines of the item when the example compiles", () => {
    // GIVEN every showing with an item whose example compiles
    for (const { question, showing } of showings) {
      const { compilation } = placed(showing);
      const file = compilation.files[0];
      const { item } = showing;
      if (item === undefined || file === undefined) {
        continue;
      }
      // THEN the file traces lines to the item
      const traced = file.trace.some(
        ({ provenance }) => provenance.source !== undefined && sameItem(provenance.source, item),
      );
      expect(traced, `${question.id} on ${showing.example}`).toBe(true);
    }
  });
});

describe("the references to the questions", () => {
  it("resolve: every id an example page or mapping.md names is a question", () => {
    // GIVEN the ids the example pages and mapping.md reference
    // THEN each names a question of the register
    for (const id of [...REFERENCED_ON_PAGES, ...LINKED_FROM_MAPPING]) {
      expect(questionById(id), id).toBeDefined();
    }
  });

  it("leave no question orphaned: each is linked from mapping.md or shown on an example page", () => {
    // GIVEN every question
    const referenced = new Set([...REFERENCED_ON_PAGES, ...LINKED_FROM_MAPPING]);
    // THEN something references it
    const orphans = QUESTIONS.filter((question) => !referenced.has(question.id)).map((q) => q.id);
    expect(orphans).toEqual([]);
  });
});
