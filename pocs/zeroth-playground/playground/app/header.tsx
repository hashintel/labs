import { HashWordmark } from "../theme/hash-wordmark";
import { ExamplePicker } from "./example-picker";
import { ViewSwitch } from "./view-switch";

import type { View } from "./route";

import "./header.css";

type HeaderProps = {
  view: View;
  onSelectView: (view: View) => void;
  exampleId: string;
  /** The IR text, the options or the module differ from the example as it opens. */
  changed: boolean;
  onSelectExample: (id: string) => void;
  onReset: () => void;
};

/** The views that work on the example the picker names; the Semantics view does not. */
const EXAMPLE_VIEWS: readonly View[] = ["playground", "compiler"];

/** A counter-clockwise arrow: back to how the example opens. */
const ResetIcon: React.FC = () => {
  return (
    <svg className="header__reset-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 6a3.5 3.5 0 1 0 1.03-2.48" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.2 1.6v2.6h2.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
};

export const Header: React.FC<HeaderProps> = ({
  view,
  onSelectView,
  exampleId,
  changed,
  onSelectExample,
  onReset,
}) => {
  return (
    <header className="header">
      <div className="header__brand">
        <HashWordmark className="header__wordmark" />
        <h1 className="caps header__title">
          Petri net <i>to</i> reactive modules
        </h1>
      </div>
      <ViewSwitch view={view} onSelect={onSelectView} />
      {/* The picker names the example the Playground and Compiler views work on; the Semantics view is general. */}
      <div className="header__example" hidden={!EXAMPLE_VIEWS.includes(view)}>
        {changed ? (
          <button
            type="button"
            className="header__reset"
            title="Return the IR, the options and the module to the example as it opens"
            onClick={onReset}
          >
            <ResetIcon />
            Reset
          </button>
        ) : null}
        <ExamplePicker exampleId={exampleId} onSelect={onSelectExample} />
      </div>
    </header>
  );
};
