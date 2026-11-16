import type { View } from "./route";

import "./view-switch.css";

const VIEWS: readonly { id: View; label: string }[] = [
  { id: "playground", label: "Examples" },
  { id: "semantics", label: "Questions" },
];

type ViewSwitchProps = {
  view: View;
  /** Where each view's link goes: the view on what it last showed. */
  targets: Record<View, string>;
};

export const ViewSwitch: React.FC<ViewSwitchProps> = ({ view, targets }) => {
  return (
    <nav className="header__views" aria-label="Views">
      {VIEWS.map((option) => (
        <a
          key={option.id}
          href={targets[option.id]}
          className="caps header__view"
          aria-current={option.id === view ? "page" : undefined}
        >
          {option.label}
        </a>
      ))}
    </nav>
  );
};
