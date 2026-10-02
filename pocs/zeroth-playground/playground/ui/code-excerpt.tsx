import type { Excerpt } from "./excerpt";

import "./code-excerpt.css";

/**
 * A few lines quoted from a text, numbered as in the source, under the name
 * of the text. A lit line is washed as the editors wash it, and a dashed
 * hairline marks where the numbers skip.
 */
export const CodeExcerpt: React.FC<{ excerpt: Excerpt }> = ({ excerpt }) => {
  return (
    <figure className="code-excerpt">
      <figcaption className="caps code-excerpt__source">{excerpt.source}</figcaption>
      <pre>
        {excerpt.lines.map((line, index) => {
          const previous = excerpt.lines[index - 1];
          const skipped = previous !== undefined && line.number > previous.number + 1;
          return (
            <span key={line.number} className="code-excerpt__line" data-lit={line.lit} data-skipped={skipped}>
              <span className="code-excerpt__number">{line.number}</span>
              {line.text === "" ? " " : line.text}
            </span>
          );
        })}
      </pre>
    </figure>
  );
};
