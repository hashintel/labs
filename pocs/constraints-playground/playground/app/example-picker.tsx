import { useState } from "react";

import { exampleById } from "../../examples/catalog";

import { stepIndex } from "../ui/roving";
import { SANDBOX_NAME, PRESSING_IDS, collapseRows, contextOf, filterRows, groupRows, highlight, rowOf, shownExamples } from "./example-list";

import type { Row } from "./example-list";

import "./example-picker.css";

type ExamplePickerProps = {
  exampleId: string;
  /** MTL is on: the MTL group shows. */
  mtl: boolean;
  /** Nested operators are on: the nested group shows. */
  nested: boolean;
  onSelect: (id: string) => void;
};

const LIST_ID = "example-list";

/** The text with the part a search matched in a `mark`. */
const Highlighted: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  return highlight(text, query).map((part, index) =>
    part.match ? (
      <mark key={index} className="picker__match">
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  );
};

/** The search field and the rows of the open list, in order, for the arrow keys. */
function stopsOf(list: HTMLElement): HTMLElement[] {
  return [
    ...list.querySelectorAll<HTMLElement>('.picker__search, [role="option"]'),
  ];
}

/**
 * Arrow keys walk from the search field down the rows and back; Home and End
 * jump to the ends of the rows, and stay the caret's in the field. Tab from a
 * row closes the list, which hands the focus back to the button, and moves on
 * from there. Escape and outside clicks are the popover's.
 */
function walk(event: React.KeyboardEvent<HTMLDivElement>) {
  const inField = (event.target as HTMLElement).classList.contains("picker__search");
  if (event.key === "Tab" && !inField && (event.target as HTMLElement).getAttribute("role") === "option") {
    event.currentTarget.hidePopover();
    return;
  }
  if (inField && (event.key === "Home" || event.key === "End")) {
    return;
  }
  const stops = stopsOf(event.currentTarget);
  const at = stops.indexOf(document.activeElement as HTMLElement);
  const next = stepIndex(event.key, at, stops.length);
  if (next === null) {
    return;
  }
  event.preventDefault();
  stops[next]?.focus();
}

/**
 * The example picker: a button naming the open example by the question it
 * answers (the sandbox by its title), and a popover with a search field and
 * the examples grouped by the construct they tackle. Collapsed, the list keeps
 * the sandbox and the rows in `PRESSING` (the questions for the team) and
 * ends in "Show more"; expanded,
 * it shows every row and ends in "Show less". A search shows every match and
 * no button. A row is the rule in the builder's words over the question it
 * answers; a check marks the open one. Unlisted examples appear only while
 * open. The popover is anchored under the button by CSS anchor positioning,
 * and closes on a choice, Escape, Tab from a row or a click outside.
 */
export const ExamplePicker: React.FC<ExamplePickerProps> = ({ exampleId, mtl, nested, onSelect }) => {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  // The row the footer describes: the last one hovered or focused.
  const [active, setActive] = useState<string | null>(null);
  const current = exampleById(exampleId);
  const examples = shownExamples(exampleId, mtl, nested);
  const rows = examples.map(rowOf);
  const found = groupRows(filterRows(rows, query));
  const searching = query.trim() !== "";
  const collapsed = collapseRows(found, PRESSING_IDS);
  const groups = searching || showAll ? found : collapsed;
  const countRows = (list: typeof found) => list.reduce((sum, group) => sum + group.rows.length, 0);
  const about = exampleById(active ?? exampleId);
  const label = current?.group === "sandbox" ? SANDBOX_NAME : (current?.question ?? "");

  function toggle(event: React.ToggleEvent<HTMLDivElement>) {
    if (event.newState === "open") {
      // Opening the list puts the focus in the search field, so typing searches at once.
      event.currentTarget.querySelector<HTMLInputElement>(".picker__search")?.focus();
    } else {
      setQuery("");
      setShowAll(false);
      setActive(null);
    }
  }

  function enter(event: React.KeyboardEvent<HTMLInputElement>) {
    const first = groups[0]?.rows[0];
    if (event.key === "Enter" && first !== undefined) {
      onSelect(first.example.id);
      event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
    }
  }

  function renderRow({ example, rule, question, named }: Row) {
    return (
      <button
        key={example.id}
        type="button"
        role="option"
        className="picker__option"
        data-example={example.id}
        data-pressing={showAll && !searching && PRESSING_IDS.has(example.id) ? "" : undefined}
        aria-selected={example.id === exampleId}
        aria-description={example.title}
        tabIndex={-1}
        popoverTarget={LIST_ID}
        popoverTargetAction="hide"
        onFocus={() => setActive(example.id)}
        onPointerEnter={() => setActive(example.id)}
        onClick={() => onSelect(example.id)}
      >
        <span className={named ? "picker__rule picker__rule--named" : "picker__rule"}>
          <Highlighted text={rule} query={query} />
        </span>
        <span className="picker__question">{question}</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className="picker__trigger"
        popoverTarget={LIST_ID}
        aria-haspopup="dialog"
        aria-label={`Example: ${label}`}
      >
        <span className="picker__label">{label}</span>
        <span className="picker__chevron" aria-hidden="true" />
      </button>
      <div id={LIST_ID} className="picker__list" popover="auto" aria-label="Examples" onKeyDown={walk} onToggle={toggle} onPointerLeave={() => setActive(null)}>
        <div className="picker__head">
          <label className="picker__field">
            <svg className="picker__search-icon" viewBox="0 0 12 12" aria-hidden="true">
              <circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7.8 7.8 10.8 10.8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              className="picker__search"
              placeholder="Search rules"
              aria-label="Search rules"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={enter}
            />
          </label>
        </div>
        <div className="picker__scroll">
        <div role="listbox" aria-label="Examples" className="picker__rows">
          {groups.map((group) => {
            const titleId = `${LIST_ID}-${group.id}`;
            return (
              <div key={group.id} role="group" aria-labelledby={titleId} className="picker__group">
                <div id={titleId} className="caps picker__group-title">
                  {group.title}
                </div>
                {group.rows.map(renderRow)}
              </div>
            );
          })}
          {groups.length === 0 ? <p className="note picker__empty">No rules match</p> : null}
          {searching || countRows(found) === countRows(collapsed) ? null : (
            <button type="button" className="picker__more" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show less" : "Show more"}
            </button>
          )}
        </div>
        </div>
        <p className="picker__about" aria-hidden="true">
          <span className="caps picker__about-net">{about?.title}</span>
          <span className="picker__about-text">{about === undefined ? "" : contextOf(about)}</span>
        </p>
      </div>
    </>
  );
};
