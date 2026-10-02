import { Children, isValidElement } from "react";

import "./code-block.css";

/** The text of a code block's children: MDX hands `pre` one `code` element holding the text. */
function textOf(node: React.ReactNode): string {
  if (typeof node === "string") {
    return node;
  }
  if (isValidElement<{ children?: React.ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return Children.toArray(node).map(textOf).join("");
}

/**
 * A fenced code block on a page, one row per line. A long line wraps under
 * its own indent, so it stays readable in a docs panel 200 px wide instead
 * of scrolling out of sight.
 */
export const CodeBlock: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const lines = textOf(children).replace(/\n$/u, "").split("\n");
  return (
    <pre className="code-block">
      <code>
        {lines.map((line, index) => (
          <span key={index} className="code-block__line">
            {line}
          </span>
        ))}
      </code>
    </pre>
  );
};
