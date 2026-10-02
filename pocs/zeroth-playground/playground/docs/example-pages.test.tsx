import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { questionById } from "../../semantics/register";
import CompilerGuide from "../compiler-view/compiler-guide.mdx";
import { EXAMPLE_PAGES } from "./example-pages";
import { PAGE_COMPONENTS } from "./page-components";

/** The question ids the rendered cards carry. */
function referencedQuestions(html: string): string[] {
  return Array.from(html.matchAll(/data-question="([^"]*)"/gu), (match) => match[1] ?? "");
}

describe("the example pages", () => {
  for (const [id, Page] of Object.entries(EXAMPLE_PAGES)) {
    it(`render ${id}'s page with the components the documentation view passes`, () => {
      // GIVEN the page and the components the documentation view passes it
      // WHEN it renders, which throws on a component it uses but neither imports nor is passed,
      // and on a question the register does not hold
      const html = renderToStaticMarkup(<Page components={PAGE_COMPONENTS} />);
      // THEN each question card resolved to a question of the register
      for (const question of referencedQuestions(html)) {
        expect(questionById(question), question).toBeDefined();
      }
    });
  }
});

describe("the Compiler guide", () => {
  it("renders with the components the documentation view passes", () => {
    // GIVEN the guide and the components the documentation view passes a page
    // WHEN it renders
    const html = renderToStaticMarkup(<CompilerGuide components={PAGE_COMPONENTS} />);
    // THEN it holds its stages section
    expect(html).toContain("The stages");
  });
});
