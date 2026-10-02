import { useState } from "react";

import { EXAMPLES, LADDER, exampleById } from "../../examples/catalog";

type ExamplePickerProps = {
  exampleId: string;
  onSelect: (id: string) => void;
};

const LIST_ID = "example-list";

/** The options of the open list, in order, for the arrow keys. */
function optionsOf(list: HTMLElement): HTMLButtonElement[] {
  return [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')];
}

/**
 * Arrow keys walk the options; Home and End jump to the ends. Tab closes the
 * list, which hands the focus back to the button, and moves on from there.
 * Escape and outside clicks are the popover's.
 */
function walk(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key === "Tab") {
    event.currentTarget.hidePopover();
    return;
  }
  const options = optionsOf(event.currentTarget);
  const at = options.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "ArrowDown"
      ? at + 1
      : event.key === "ArrowUp"
        ? at - 1
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : null;
  if (next === null) {
    return;
  }
  event.preventDefault();
  options[Math.max(0, Math.min(options.length - 1, next))]?.focus();
}

/**
 * The example picker: a button naming the open example by what it tackles
 * and the net it uses, and a popover listing the examples up the ladder,
 * rung by rung, one line each. A check marks the open one. The footer names
 * the net and the summary of the example under the pointer or the keyboard
 * focus. Unlisted examples appear only while open. The popover is anchored
 * under the button by CSS anchor positioning, and closes on a choice,
 * Escape, Tab or a click outside.
 */
export const ExamplePicker: React.FC<ExamplePickerProps> = ({ exampleId, onSelect }) => {
  // The option holding the keyboard focus, the one Tab would reach.
  const [focused, setFocused] = useState<string | null>(null);
  // The option the footer describes: the last one hovered or focused.
  const [active, setActive] = useState<string | null>(null);
  const current = exampleById(exampleId);
  const shown = EXAMPLES.filter((example) => example.listed || example.id === exampleId);
  const about = exampleById(active ?? exampleId);
  const tabStop = focused ?? exampleId;

  function toggle(event: React.ToggleEvent<HTMLDivElement>) {
    if (event.newState === "open") {
      // Opening the list puts the focus on the example already open.
      event.currentTarget.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    } else {
      setFocused(null);
      setActive(null);
    }
  }

  return (
    <>
      <button
        type="button"
        className="picker__trigger"
        popoverTarget={LIST_ID}
        aria-haspopup="listbox"
        aria-label={`Example: ${current?.feature ?? ""}, ${current?.title ?? ""}`}
      >
        <span className="picker__label">
          <span className="picker__feature">{current?.feature}</span>
          <span className="picker__net">{current?.title}</span>
        </span>
        <span className="picker__chevron" aria-hidden="true" />
      </button>
      <div
        id={LIST_ID}
        className="picker__list"
        popover="auto"
        role="listbox"
        aria-label="Examples"
        onKeyDown={walk}
        onToggle={toggle}
        onPointerLeave={() => setActive(focused)}
      >
        {LADDER.map((rung) => {
          const examples = shown.filter((example) => example.rung === rung.id);
          const titleId = `${LIST_ID}-${rung.id}`;
          return examples.length === 0 ? null : (
            <div key={rung.id} role="group" aria-labelledby={titleId} className="picker__group">
              <div id={titleId} className="picker__group-title">
                {rung.title}
              </div>
              {examples.map((example) => (
                <button
                  key={example.id}
                  type="button"
                  role="option"
                  className="picker__option"
                  data-example={example.id}
                  aria-selected={example.id === exampleId}
                  aria-description={`${example.title}. ${example.summary}`}
                  tabIndex={example.id === tabStop ? 0 : -1}
                  popoverTarget={LIST_ID}
                  popoverTargetAction="hide"
                  onFocus={() => {
                    setFocused(example.id);
                    setActive(example.id);
                  }}
                  onPointerEnter={() => setActive(example.id)}
                  onClick={() => onSelect(example.id)}
                >
                  <span className="picker__check" aria-hidden="true" />
                  <span className="picker__feature">{example.feature}</span>
                </button>
              ))}
            </div>
          );
        })}
        <p className="picker__about" aria-hidden="true">
          <span className="picker__about-net">{about?.title}</span>
          {about?.summary}
        </p>
      </div>
    </>
  );
};
