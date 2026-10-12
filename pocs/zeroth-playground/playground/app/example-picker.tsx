import { EXAMPLES } from "../../examples/catalog";

import "./example-picker.css";

export const ExamplePicker: React.FC<{ exampleId: string; onSelect: (id: string) => void }> = ({ exampleId, onSelect }) => (
  <select
    className="picker__trigger"
    aria-label="Example"
    value={exampleId}
    onChange={(event) => onSelect(event.target.value)}
  >
    {EXAMPLES.map((example) => <option key={example.id} value={example.id}>{example.feature}</option>)}
  </select>
);
