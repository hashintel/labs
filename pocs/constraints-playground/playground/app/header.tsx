import { HashWordmark } from "../theme/hash-wordmark";
import { shownExamples } from "./example-list";
import { ExamplePicker } from "./example-picker";

import "./header.css";

type HeaderProps = {
  exampleId: string;
  /** Either text differs from the example as it opened. */
  changed: boolean;
  mtl: boolean;
  nested: boolean;
  onSelectExample: (id: string) => void;
  onReset: () => void;
  onToggleMtl: (mtl: boolean) => void;
  onToggleNested: (nested: boolean) => void;
};

/** A counter-clockwise arrow: back to how the example opened. */
const ResetIcon: React.FC = () => {
  return (
    <svg className="header__reset-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 6a3.5 3.5 0 1 0 1.03-2.48" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.2 1.6v2.6h2.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
};

/** A chevron pointing left or right, for the previous and next example. */
const StepIcon: React.FC<{ direction: "previous" | "next" }> = ({ direction }) => {
  return (
    <svg className="header__step-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d={direction === "previous" ? "M7.5 2.5 4 6l3.5 3.5" : "M4.5 2.5 8 6 4.5 9.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const Header: React.FC<HeaderProps> = ({
  exampleId,
  changed,
  mtl,
  nested,
  onSelectExample,
  onReset,
  onToggleMtl,
  onToggleNested,
}) => {
  const shown = shownExamples(exampleId, mtl, nested);
  const at = shown.findIndex((example) => example.id === exampleId);
  const previous = shown[at - 1];
  const next = shown[at + 1];

  return (
    <header className="header">
      <div className="header__brand">
        <HashWordmark className="header__wordmark" />
        <h1 className="caps header__title">Constraint playground</h1>
        <div className="header__examples">
          <ExamplePicker exampleId={exampleId} mtl={mtl} nested={nested} onSelect={onSelectExample} />
          <button
            type="button"
            className="header__step"
            aria-label="Previous example"
            title="Previous example"
            disabled={previous === undefined}
            onClick={() => previous !== undefined && onSelectExample(previous.id)}
          >
            <StepIcon direction="previous" />
          </button>
          <button
            type="button"
            className="header__step"
            aria-label="Next example"
            title="Next example"
            disabled={next === undefined}
            onClick={() => next !== undefined && onSelectExample(next.id)}
          >
            <StepIcon direction="next" />
          </button>
        </div>
      </div>
      <div className="header__example">
        {changed ? (
          <button
            type="button"
            className="header__reset"
            title="Return the net and the constraint to the example as it opened"
            onClick={onReset}
          >
            <ResetIcon />
            Reset
          </button>
        ) : null}
        <span className="caps header__flag" title="The scope agreed on 6 Oct. Tick a box to go beyond it.">
          Base: LTL
        </span>
        <label
          className="caps header__flag"
          title="Lets a temporal operator sit inside another, like always(A implies eventually(B)). The base has one operator, at the top."
        >
          <input type="checkbox" checked={nested} onChange={(event) => onToggleNested(event.target.checked)} />
          Nested operators
        </label>
        <label
          className="caps header__flag"
          title="Adds time windows to always, eventually and until. LTL alone has none."
        >
          <input type="checkbox" checked={mtl} onChange={(event) => onToggleMtl(event.target.checked)} />
          MTL (time windows)
        </label>
      </div>
    </header>
  );
};
