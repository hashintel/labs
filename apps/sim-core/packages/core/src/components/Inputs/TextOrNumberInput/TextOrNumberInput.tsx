import React, { FC } from "react";

import { RoundedTextInput } from "../RoundedTextInput";

import "./TextOrNumberInput.scss";

export const TextOrNumberInput: FC<{
  name?: string;
  value: string | number;
  onChange: (value: string | number) => void;
  min: number | undefined;
  max: number | undefined;
  step: number | undefined;
  type?: "string" | "number" | undefined | null;
}> = ({ name, value, onChange, min, max, step, type }) => {
  const fieldType = type ?? typeof value;

  return (
    <div className="TextOrNumberInput">
      {fieldType === "number" && min !== undefined && max !== undefined ? (
        <input
          type="range"
          name={name}
          min={min}
          max={max}
          step={step}
          value={typeof value === "string" ? parseFloat(value) : value}
          onChange={(evt) => onChange(evt.target.value)}
          className="TextOrNumberInput__Range"
        />
      ) : null}
      <RoundedTextInput
        type={fieldType}
        name={name}
        value={value}
        id={name}
        onChange={(evt) => onChange(evt.target.value)}
        {...(fieldType === "number" ? { min, max, step } : {})}
      />
    </div>
  );
};
