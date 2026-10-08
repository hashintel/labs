import { useId, useState } from "react";

import { stepIndex } from "../ui/roving";
import { HintPopover, useHint } from "./hint";
import type { Hint } from "./hints";

import "./pick.css";

export type PickOption = { value: string; label: string; /** A hover title: the plain meaning of a symbol. */ title?: string };
export type PickGroup = { title?: string; options: readonly PickOption[] };

type PickProps = {
  /** What is picked, for screen readers: "Comparison". */
  label: string;
  /** What the trigger shows. */
  text: string;
  /** A hover title for the trigger. */
  title?: string;
  /** A hover and focus popover for the trigger: a keyword's meaning, and for an operator a mini timeline. */
  hint?: Hint;
  /** The value of the chosen option. */
  value: string;
  groups: readonly PickGroup[];
  /** A search field over all groups, and jump links to each group. */
  searchable?: boolean;
  /** Classes for the trigger, which sits in a chip. */
  className?: string;
  onPick: (value: string) => void;
};

/** The options of the open list, in order, for the arrow keys. */
function optionsOf(list: HTMLElement): HTMLButtonElement[] {
  return [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')];
}

/**
 * Arrow keys walk the options, from the search field too. Tab closes the
 * list, which hands the focus back to the trigger. Escape and outside clicks
 * are the popover's.
 */
export function walk(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key === "Tab") {
    event.currentTarget.hidePopover();
    return;
  }
  const options = optionsOf(event.currentTarget);
  const at = options.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0 && event.key !== "ArrowDown") {
    return;
  }
  const next = stepIndex(event.key, at, options.length);
  if (next === null) {
    return;
  }
  event.preventDefault();
  options[next]?.focus();
}

/**
 * A chip segment that opens a list of options in a popover under it. The
 * list is built only while open, so a page of chips stays light. A search
 * field filters across groups, and Enter in it takes the first match.
 */
export const Pick: React.FC<PickProps> = ({ label, text, title, hint, value, groups, searchable, className, onPick }) => {
  const popoverId = `pick${useId().replace(/[^a-zA-Z0-9_-]/gu, "")}`;
  const [open, setOpen] = useState(false);
  const hinted = useHint();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = groups
    .map((group) => ({ ...group, options: group.options.filter((option) => option.label.toLowerCase().includes(needle)) }))
    .filter((group) => group.options.length > 0);
  const first = shown[0]?.options[0];

  function toggle(event: React.ToggleEvent<HTMLDivElement>) {
    setOpen(event.newState === "open");
    if (event.newState !== "open") {
      setQuery("");
    }
  }

  return (
    <>
      <button
        type="button"
        className={`pick ${className ?? ""}`}
        popoverTarget={popoverId}
        aria-haspopup="listbox"
        aria-label={`${label}: ${text}`}
        title={title}
        aria-describedby={hint !== undefined && hinted.open ? `${popoverId}-hint` : undefined}
        style={{ anchorName: `--${popoverId}` } as React.CSSProperties}
        {...(hint === undefined ? {} : hinted.triggers)}
      >
        {text}
      </button>
      {hint !== undefined && hinted.open ? (
        <HintPopover hint={hint} id={`${popoverId}-hint`} anchor={`--${popoverId}`} />
      ) : null}
      <div
        id={popoverId}
        className="pick__list"
        popover="auto"
        role="listbox"
        aria-label={label}
        style={{ positionAnchor: `--${popoverId}` } as React.CSSProperties}
        onKeyDown={walk}
        onToggle={toggle}
      >
        {open && (
          <>
            {searchable && (
              <input
                className="pick__search"
                type="search"
                autoFocus
                placeholder="Search"
                aria-label={`Search ${label.toLowerCase()}`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && first) {
                    event.preventDefault();
                    onPick(first.value);
                    event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
                  }
                }}
              />
            )}
            {searchable && needle === "" && shown.length > 1 && (
              <div className="pick__jumps">
                {shown.map((group, at) => (
                  <button
                    key={group.title}
                    type="button"
                    tabIndex={-1}
                    className="pick__jump"
                    onClick={() => document.getElementById(`${popoverId}-${at}`)?.scrollIntoView({ block: "start" })}
                  >
                    {group.title}
                  </button>
                ))}
              </div>
            )}
            <div className="pick__groups">
              {shown.map((group, at) => (
                <div key={group.title ?? at} role="group" id={`${popoverId}-${at}`} className="pick__group">
                  {group.title && <div className="caps pick__group-title">{group.title}</div>}
                  {group.options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      className="pick__option"
                      aria-selected={option.value === value}
                      title={option.title}
                      autoFocus={!searchable && option.value === value}
                      popoverTarget={popoverId}
                      popoverTargetAction="hide"
                      onClick={() => onPick(option.value)}
                    >
                      <span className="pick__check" aria-hidden="true" />
                      {option.label}
                    </button>
                  ))}
                </div>
              ))}
              {shown.length === 0 && <p className="pick__none">Nothing matches.</p>}
            </div>
          </>
        )}
      </div>
    </>
  );
};
