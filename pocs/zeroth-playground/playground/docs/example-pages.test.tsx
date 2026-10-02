import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import CompilerGuide from "../compiler-view/compiler-guide.mdx";
import { EXAMPLE_PAGES } from "./example-pages";
import { PAGE_COMPONENTS } from "./page-components";

/** The owners an open question can name, as `OpenQuestion` types them; MDX is not type-checked. */
const OWNER = /^(HASH|Zeroth|HASH and Zeroth)$/u;

/** The owners in a page's markup that `OpenQuestion` does not allow. */
function strayOwners(html: string): (string | undefined)[] {
  const owners = Array.from(html.matchAll(/open-question__owner">For ([^<]*)</gu), (match) => match[1]);
  return owners.filter((owner) => !OWNER.test(owner ?? ""));
}

describe("the example pages", () => {
  for (const [id, Page] of Object.entries(EXAMPLE_PAGES)) {
    it(`render ${id}'s page with the components the documentation view passes`, () => {
      // GIVEN the page and the components the documentation view passes it
      // WHEN it renders, which throws on a component it uses but neither imports nor is passed
      const html = renderToStaticMarkup(<Page components={PAGE_COMPONENTS} />);
      // THEN each open question names who can settle it
      expect(strayOwners(html)).toEqual([]);
    });
  }
});

describe("the Compiler guide", () => {
  it("renders with the components the documentation view passes", () => {
    // GIVEN the guide and the components the documentation view passes a page
    // WHEN it renders
    const html = renderToStaticMarkup(<CompilerGuide components={PAGE_COMPONENTS} />);
    // THEN it has an open question, and each one names who can settle it
    expect(html).toContain("open-question__owner");
    expect(strayOwners(html)).toEqual([]);
  });
});
