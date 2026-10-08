import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { exampleById } from "../../examples/catalog";
import { EXAMPLE_PAGES } from "./example-pages";
import { meaningOf } from "./glossary";
import { pageComponents } from "./page-components";
import { ruleTextOf } from "./rule";

/** A page's MDX source as written. A `?raw` import would go through the MDX plugin. */
function sourceOf(id: string): string {
  return readFileSync(new URL(`../../examples/${id}/page.mdx`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
}

/** The glossary entry each `<Term>` in a page's source names: its `name`, else its text. */
function termsIn(source: string): string[] {
  return [...source.matchAll(/<Term(?: name="([^"]+)")?>([^<]+)<\/Term>/gu)].map((match) => match[1] ?? match[2] ?? "");
}

describe("the example pages", () => {
  for (const [id, Page] of Object.entries(EXAMPLE_PAGES)) {
    it(`render ${id}'s page with the components the documentation view passes`, () => {
      // GIVEN the page and the components the documentation view passes it
      // WHEN it renders, which throws on a component it uses but neither imports nor is passed, or on a term the glossary lacks
      const html = renderToStaticMarkup(<Page components={pageComponents(id)} />);
      // THEN it has some content
      expect(html.length).toBeGreaterThan(0);
    });

    it(`show ${id}'s rule as the builder displays it`, () => {
      // GIVEN the page rendered with its example's components
      const html = renderToStaticMarkup(<Page components={pageComponents(id)} />);
      const example = exampleById(id);
      // WHEN the example's rule is read in the builder's words
      const rule = example === undefined ? "" : ruleTextOf(example);
      // THEN the page's Rule block holds it, with no lowercase keyword left
      expect(rule, id).not.toBe("");
      expect(html).toContain(rule.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
      expect(rule).not.toMatch(/(?:always|eventually|until|and|or|not|implies|iff|if|then|else)/u);
    });

    it(`open ${id}'s page on the context its meta.ts declares`, () => {
      // GIVEN the page's source and its example
      const source = sourceOf(id);
      // WHEN its Context line is read
      const context = /^<Context>(.*)<\/Context>$/mu.exec(source)?.[1];
      // THEN it is the page's first line and the same text as meta.context
      expect(source.startsWith("<Context>")).toBe(true);
      expect(context).toBe(exampleById(id)?.context);
    });
  }

  it("wrap only terms the glossary explains", () => {
    // GIVEN every term the pages wrap
    const terms = Object.keys(EXAMPLE_PAGES).map(sourceOf).flatMap(termsIn);
    // THEN each has a glossary line
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.filter((term) => meaningOf(term) === undefined)).toEqual([]);
  });
});
