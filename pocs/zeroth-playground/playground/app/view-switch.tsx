import type { View } from "./route";

import "./view-switch.css";

const VIEWS: readonly { id: View; label: string }[] = [
  { id: "examples", label: "Examples" },
  { id: "compiler", label: "Compiler" },
  { id: "semantics", label: "Semantics" },
];

type ViewSwitchProps = {
  view: View;
  onSelect: (view: View) => void;
};

/** The views as a segmented control: the one shown is pressed. */
export const ViewSwitch: React.FC<ViewSwitchProps> = ({ view, onSelect }) => {
  return (
    <nav className="header__views" aria-label="Views">
      {VIEWS.map((option) => (
        <button
          key={option.id}
          type="button"
          className="caps header__view"
          aria-pressed={option.id === view}
          onClick={() => onSelect(option.id)}
        >
          {option.label}
        </button>
      ))}
    </nav>
  );
};
