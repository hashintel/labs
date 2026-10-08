import type { Window as TimeWindow } from "../../constraints/ast";
import { DEFAULT_WINDOW } from "./edits";
import { NumberField } from "./number-field";

type WindowFieldProps = {
  window: TimeWindow | undefined;
  /** Whether MTL is on: "+ window" shows only then. A window the constraint already has always shows. */
  mtl: boolean;
  onChange: (next: TimeWindow | undefined) => void;
};

/**
 * The optional time window of an operator: "+ window" while it has none,
 * then "[ a , b ]" with a remove. The time units are in the hover title.
 */
export const WindowField: React.FC<WindowFieldProps> = ({ window, mtl, onChange }) =>
  window === undefined ? (
    mtl ? (
      <button type="button" className="action action--inline" onClick={() => onChange(DEFAULT_WINDOW)}>
        + window
      </button>
    ) : null
  ) : (
    <span className="chip chip--window" role="group" aria-label="Time window" title="Time window, in time units">
      <span className="chip__seg chip__word">[</span>
      <NumberField value={window.from} label="Window start" onChange={(from) => onChange({ ...window, from })} />
      <span className="chip__seg chip__word">,</span>
      <NumberField value={window.to} label="Window end" onChange={(to) => onChange({ ...window, to })} />
      <span className="chip__seg chip__word">]</span>
      <button type="button" className="chip__remove" aria-label="Remove window" onClick={() => onChange(undefined)} />
    </span>
  );
