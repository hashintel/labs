import { exampleById } from "../../examples/catalog";
import { EXAMPLE_PAGES } from "./example-pages";
import { pageComponents } from "./page-components";

import "./documentation.css";

/**
 * The example's page: the net it uses and the feature it tackles, from its
 * metadata, over the page itself.
 */
export const Documentation: React.FC<{ exampleId: string }> = ({ exampleId }) => {
  const example = exampleById(exampleId);
  const Page = EXAMPLE_PAGES[exampleId];
  return (
    <article className="docs prose">
      {example === undefined ? null : (
        <>
          <p className="caps docs__net">{example.title}</p>
          <h2>{example.feature}</h2>
        </>
      )}
      {Page === undefined ? <p className="note">This example has no page.</p> : <Page components={pageComponents(exampleId)} />}
    </article>
  );
};
