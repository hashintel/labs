import { exampleById } from "../../examples/catalog";
import { hashOf } from "../app/route";
import { setOptionLabels } from "../options/option-labels";
import { CodeExcerpt } from "../ui/code-excerpt";
import { evidenceOf } from "./evidence";

import type { Showing } from "../../semantics/register";

import "./showing-view.css";

/**
 * One place a question shows: the example and the options that bring the
 * behaviour out, a link that opens them in the Playground view, and the lines
 * the compiler writes for the net item, compiled here from the catalog.
 */
export const ShowingView: React.FC<{ showing: Showing }> = ({ showing }) => {
  const example = exampleById(showing.example);
  if (example === undefined) {
    return <p className="note">The catalog has no example {showing.example}.</p>;
  }
  const options = showing.options ?? {};
  const labels = setOptionLabels(options);
  const evidence = evidenceOf(example, showing);
  return (
    <div className="showing" data-example={example.id}>
      <div className="showing__head">
        <p className="showing__example">
          <span className="showing__feature">{example.feature}</span>
          <span className="caps showing__net">{example.title}</span>
        </p>
        <p className="caps showing__options">{labels.length === 0 ? "Default options" : labels.join(" · ")}</p>
        <a
          className="showing__open"
          href={hashOf({ view: "playground", example, options })}
          title="Open the example in the Playground view with these options"
        >
          Open in Playground
        </a>
      </div>
      {evidence.kind === "refused" ? (
        <p className="showing__refused">{evidence.message}</p>
      ) : (
        <CodeExcerpt excerpt={evidence.excerpt} />
      )}
    </div>
  );
};
