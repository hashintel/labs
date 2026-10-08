import { useRef, useState } from "react";

import { HINT_STEPS } from "./hints";
import type { Hint } from "./hints";

import "./hint.css";

/** How long the pointer rests on a keyword before its hint appears. Keyboard focus shows it at once. */
const SHOW_DELAY_MS = 350;

type HintTriggers = {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
  onFocus: (event: React.FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
};

/**
 * When a hint shows, and the handlers that decide it: after a short rest
 * under the pointer, at once on keyboard focus, never after a click, hidden
 * on leaving, blur and Escape. The timer lives in the handlers that start it.
 */
export function useHint(): { open: boolean; triggers: HintTriggers } {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  function hide() {
    window.clearTimeout(timer.current);
    setOpen(false);
  }

  return {
    open,
    triggers: {
      onPointerEnter: () => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
      },
      onPointerLeave: hide,
      onPointerDown: hide,
      // A click focuses the button too; only keyboard focus shows the hint.
      onFocus: (event) => {
        if (event.currentTarget.matches(":focus-visible")) {
          setOpen(true);
        }
      },
      onBlur: hide,
      onKeyDown: (event) => {
        if (event.key === "Escape") {
          hide();
        }
      },
    },
  };
}

/** Shows the popover as it mounts; it leaves the top layer when it unmounts. */
function showOnMount(element: HTMLDivElement | null) {
  if (element !== null && !element.matches(":popover-open")) {
    element.showPopover();
  }
}

type HintPopoverProps = {
  hint: Hint;
  id: string;
  /** The `anchor-name` of the keyword the hint sits under. */
  anchor: string;
};

/**
 * The one hint popover: a keyword as a title, one plain line, and for an
 * operator a six-step mini timeline. It sits in the top layer under its
 * keyword and takes no pointer, so showing it moves nothing.
 */
export const HintPopover: React.FC<HintPopoverProps> = ({ hint, id, anchor }) => {
  const rows = hint.rows;
  const tagged = rows?.some((row) => row.tag !== undefined) ?? false;
  return (
    <div
      id={id}
      className="hint"
      popover="manual"
      role="tooltip"
      style={{ positionAnchor: anchor } as React.CSSProperties}
      ref={showOnMount}
    >
      {hint.title === undefined ? null : <p className="caps hint__title">{hint.title}</p>}
      <p className="hint__line">{hint.line}</p>
      {rows === undefined ? null : (
        <div className="hint__rows" data-tagged={tagged} aria-hidden="true">
          {rows.map((row, at) => (
            <div key={at} className="hint__row">
              {tagged ? <span className="hint__tag">{row.tag}</span> : null}
              {row.cells.map((cell, index) => (
                <span key={index} className="hint__cell" data-tone={cell.tone} data-decisive={cell.decisive}>
                  {cell.mark}
                </span>
              ))}
            </div>
          ))}
          <div className="hint__row hint__row--steps">
            {tagged ? <span className="hint__tag" /> : null}
            {Array.from({ length: HINT_STEPS }, (_, index) => (
              <span key={index} className="hint__step">
                {index + 1}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
