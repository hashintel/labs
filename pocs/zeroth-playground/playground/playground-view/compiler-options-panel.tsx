import { useState } from "react";

import { OPTION_LABELS, type OptionLabels } from "../options/option-labels";

import type { OptionName, OptionState } from "../../compiler";

import "./compiler-options-panel.css";

type CompilerOptionsPanelProps = {
  states: readonly OptionState[];
  onChange: (name: OptionName, value: string) => void;
};

const OptionRow: React.FC<{ labels: OptionLabels; state: OptionState; onChange: (value: string) => void }> = ({ labels, state, onChange }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const draftNumber = Number(draft);
  const invalid = draft !== null && !(Number.isFinite(draftNumber) && draftNumber > 0);
  const id = `option-${labels.name}`;
  return (
    <div className="option">
      <label className="option__label" htmlFor={id}>{labels.label}</label>
      {labels.choices === undefined ? (
        <input
          id={id}
          className="option__control"
          type="text"
          inputMode="decimal"
          value={draft ?? state.value}
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
          value={state.value}
          aria-describedby={`${id}-hint`}
          onChange={(event) => onChange(event.target.value)}
        >
          {labels.choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select>
      )}
      <p className="option__hint" id={`${id}-hint`}>{labels.hint}</p>
    </div>
  );
};

export const CompilerOptionsPanel: React.FC<CompilerOptionsPanelProps> = ({ states, onChange }) => (
  <div className="options">
    {OPTION_LABELS.map((labels) => {
      const state = states.find((candidate) => candidate.name === labels.name);
      return state === undefined || state.notApplicable !== undefined ? null : (
        <OptionRow key={labels.name} labels={labels} state={state} onChange={(value) => onChange(labels.name, value)} />
      );
    })}
  </div>
);
