import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PAGE_COMPONENTS } from "../docs/page-components";
import { QUESTION_PAGES } from "./question-pages";

async function render(element: React.ReactNode): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

describe("the question pages", () => {
  for (const [id, Page] of Object.entries(QUESTION_PAGES)) {
    it(`renders ${id} with its embedded net`, async () => {
      // GIVEN a question and the shared MDX components
      // WHEN its graph finishes laying out
      const html = await render(<Page components={PAGE_COMPONENTS} />);
      // THEN the two net questions include a diagram and an example link
      expect(html).not.toContain("Laying out the net");
      if (id === "transition-or-places-decide" || id === "marking-dependent-rates") {
        expect(html).toContain("data-example-net");
        expect(html).toContain('class="net"');
        expect(html).toContain("Open example");
      }
    });
  }

  it("gives multiple embedded nets distinct arrow markers", async () => {
    // GIVEN two copies of the same net on one page
    const Net = PAGE_COMPONENTS.ExampleNet;
    // WHEN both render
    const html = await render(<><Net example="cafe-queue" caption="First" /><Net example="cafe-queue" caption="Second" /></>);
    // THEN each arrow references a marker belonging to its own SVG
    const markers = Array.from(html.matchAll(/<marker id="([^"]+-arrow)"/gu), (match) => match[1]);
    expect(markers).toHaveLength(2);
    expect(new Set(markers).size).toBe(2);
    for (const marker of markers) expect(html).toContain(`url(#${marker})`);
  });
});
