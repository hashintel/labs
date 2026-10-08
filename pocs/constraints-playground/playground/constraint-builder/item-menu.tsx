import { useId, useState } from "react";

import { walk } from "./pick";

import "./pick.css";

export type ItemAction = { value: string; label: string };

type ItemShellProps = {
  /** What the menu acts on, for screen readers: "Condition". */
  label: string;
  actions: readonly ItemAction[];
  onAction: (value: string) => void;
  /** Draws the item and places the menu button where it belongs in it. */
  children: (menu: React.ReactNode) => React.ReactNode;
};

/**
 * One item of a list with its ••• menu. A right-click anywhere on the item
 * opens the same menu; the innermost item takes the click. The list is built
 * only while open.
 */
export const ItemShell: React.FC<ItemShellProps> = ({ label, actions, onAction, children }) => {
  const popoverId = `menu${useId().replace(/[^a-zA-Z0-9_-]/gu, "")}`;
  const [open, setOpen] = useState(false);
  const menu = (
    <>
      <button
        type="button"
        className="item__menu"
        popoverTarget={popoverId}
        aria-haspopup="menu"
        aria-label={`${label} actions`}
        title="Actions"
        style={{ anchorName: `--${popoverId}` } as React.CSSProperties}
      >
        <span aria-hidden="true">•••</span>
      </button>
      <div
        id={popoverId}
        className="pick__list item__list"
        popover="auto"
        role="menu"
        aria-label={`${label} actions`}
        style={{ positionAnchor: `--${popoverId}` } as React.CSSProperties}
        onKeyDown={walk}
        onToggle={(event) => setOpen(event.newState === "open")}
      >
        {open &&
          actions.map((action) => (
            <button
              key={action.value}
              type="button"
              role="option"
              className="pick__option"
              aria-selected={false}
              autoFocus={action === actions[0]}
              popoverTarget={popoverId}
              popoverTargetAction="hide"
              onClick={() => onAction(action.value)}
            >
              <span aria-hidden="true" />
              {action.label}
            </button>
          ))}
      </div>
    </>
  );
  return (
    <div
      className="item"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        document.getElementById(popoverId)?.showPopover();
      }}
    >
      {children(menu)}
    </div>
  );
};
