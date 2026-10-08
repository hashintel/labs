import { useState } from "react";

type NumberFieldProps = {
  value: number;
  label: string;
  onChange: (next: number) => void;
};

/**
 * A number segment. It keeps what is typed until the field loses focus, so
 * "-" or "2." can pass through on the way to a number; every typed number
 * reaches the constraint at once. A hidden copy of the text sizes the field.
 */
export const NumberField: React.FC<NumberFieldProps> = ({ value, label, onChange }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(value);
  return (
    <span className="chip__field">
      <span className="chip__mirror" aria-hidden="true">
        {text}
      </span>
      <input
        className="chip__input"
        type="text"
        inputMode="decimal"
        aria-label={label}
        size={1}
        value={text}
        onChange={(event) => {
          const typed = event.target.value;
          setDraft(typed);
          if (typed.trim() !== "" && Number.isFinite(Number(typed))) {
            onChange(Number(typed));
          }
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Escape") {
            event.currentTarget.blur();
          }
        }}
      />
    </span>
  );
};
