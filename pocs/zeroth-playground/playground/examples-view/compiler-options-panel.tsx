import { useState } from "react";

import { NOT_USED, OPTION_SECTIONS, type OptionLabels } from "../options/option-labels";

import type { OptionName, OptionState } from "../../compiler";

function sectionId(title: string): string {
  return `options-${title.toLowerCase().replaceAll(" ", "-")}`;
}

type CompilerOptionsPanelProps = {
  states: readonly OptionState[];
  onChange: (name: OptionName, value: string) => void;
};

type OptionRowProps = {
  labels: OptionLabels;
  state: OptionState;
  onChange: (value: string) => void;
};

const OptionRow: React.FC<OptionRowProps> = ({ labels, state, onChange }) => {
  // What the field holds while it has focus. "1." or an empty field is no
  // value yet, and showing the stored value instead would undo the keystroke.
  const [draft, setDraft] = useState<string | null>(null);
  const draftNumber = Number(draft);
  const invalid = draft !== null && !(Number.isFinite(draftNumber) && draftNumber > 0);
  const disabled = state.notApplicable !== undefined;
  const id = `option-${labels.name}`;
  return (
    <div className="option" data-disabled={disabled} data-nested={labels.under !== undefined}>
      <label className="option__label" htmlFor={id}>
        {labels.label}
      </label>
      {labels.choices === undefined ? (
        <input
          id={id}
          className="option__control"
          type="text"
          inputMode="decimal"
          disabled={disabled}
          value={disabled ? "" : (draft ?? state.value)}
          placeholder={disabled ? NOT_USED : undefined}
          aria-describedby={`${id}-hint`}
          aria-invalid={invalid}
          onChange={(event) => {
            setDraft(event.target.value);
            onChange(event.target.value);
          }}
          onBlur={() => setDraft(null)}
        />
      ) : (
        <select
          id={id}
          className="option__control option__control--select"
          disabled={disabled}
          value={disabled ? "" : state.value}
          aria-describedby={`${id}-hint`}
          onChange={(event) => onChange(event.target.value)}
        >
          {disabled ? (
            <option value="">{NOT_USED}</option>
          ) : (
            labels.choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))
          )}
        </select>
      )}
      {/* Off for this net, the reason replaces the hint. */}
      <p className="option__hint" id={`${id}-hint`}>
        {state.notApplicable ?? labels.hint}
      </p>
    </div>
  );
};

/**
 * The compiler options, grouped by what they decide. Each option says what it
 * does; one that only matters through another sits nested under it; one that
 * does not apply to the net is greyed, with the reason in place of its hint.
 */
export const CompilerOptionsPanel: React.FC<CompilerOptionsPanelProps> = ({ states, onChange }) => (
  <div className="options">
    {OPTION_SECTIONS.map((section) => (
      <section key={section.title} className="options__section" aria-labelledby={sectionId(section.title)}>
        <h3 className="options__title" id={sectionId(section.title)}>
          {section.title}
        </h3>
        <p className="options__about">{section.about}</p>
        {section.options.map((labels) => {
          const state = states.find((candidate) => candidate.name === labels.name);
          return state === undefined ? null : (
            <OptionRow
              key={labels.name}
              labels={labels}
              state={state}
              onChange={(value) => onChange(labels.name, value)}
            />
          );
        })}
      </section>
    ))}
  </div>
);
