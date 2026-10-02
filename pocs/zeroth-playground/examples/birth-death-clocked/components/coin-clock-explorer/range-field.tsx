import { useId } from "react";

type RangeFieldProps = {
  /** What the slider sets, with its symbol. */
  label: React.ReactNode;
  value: number;
  /** The value as read beside the label and by screen readers. */
  valueText: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
};

/** A labelled range slider with its value read out beside the label. */
export const RangeField: React.FC<RangeFieldProps> = ({ label, value, valueText, min, max, step, onChange }) => {
  const id = useId();
  return (
    <div className="explorer__field">
      <label className="explorer__field-label" htmlFor={id}>
        <span>{label}</span>
        <span className="explorer__field-value" aria-hidden="true">
          {valueText}
        </span>
      </label>
      <input
        id={id}
        className="explorer__range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
};
