import type { View } from "./route";

import "./view-switch.css";

const VIEWS: readonly { id: View; label: string }[] = [
  { id: "playground", label: "Playground" },
  { id: "compiler", label: "Compiler" },
  { id: "semantics", label: "Semantics" },
];

type ViewSwitchProps = {
  view: View;
  /** Where each view's link goes: the view on what it last showed. */
  targets: Record<View, string>;
};

/** The three views as a segmented control of links: the one shown is the current page. */
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
