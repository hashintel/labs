import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CodeBlock } from "./code-block";

describe("CodeBlock", () => {
  it("renders each line of a fenced block as a row of its own", () => {
    // GIVEN what MDX hands `pre` for a fenced block: a `code` element whose text ends in a newline
    const block = (
      <CodeBlock>
        <code className="language-python">{"fire_Go = A >= 1\nA = ite(fire_Go, A - 1, A)\n"}</code>
      </CodeBlock>
    );
    // WHEN it renders
    const html = renderToStaticMarkup(block);
    // THEN each line is one row, and the closing newline adds none
    expect(Array.from(html.matchAll(/<span class="code-block__line">([^<]*)<\/span>/gu), (match) => match[1])).toEqual([
      "fire_Go = A &gt;= 1",
      "A = ite(fire_Go, A - 1, A)",
    ]);
  });
});
