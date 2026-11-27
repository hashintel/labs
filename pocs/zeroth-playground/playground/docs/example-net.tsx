import { parsePetriNetIr } from "../../compiler";
import { exampleById } from "../../examples/catalog";
import { hashOf } from "../app/route";
import { NetPreview } from "../preview/net-preview";

import "./example-net.css";

export const ExampleNet: React.FC<{ example: string; caption: string }> = ({ example: id, caption }) => {
  const example = exampleById(id);
  const parsed = example === undefined ? undefined : parsePetriNetIr(example.ir);
  if (example === undefined || parsed === undefined || !parsed.ok) {
    throw new Error(`example ${id} is missing or has invalid YAML`);
  }
  return (
    <figure className="example-net" data-example-net={id}>
      <div className="example-net__drawing">
        <NetPreview ir={parsed.ir} />
      </div>
      <figcaption>
        {caption} <a href={hashOf({ view: "playground", example })}>Open example</a>
      </figcaption>
    </figure>
  );
};
