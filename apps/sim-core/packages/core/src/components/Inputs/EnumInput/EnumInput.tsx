import React, { FC, memo } from "react";

import { RoundedSelect } from "../Select/RoundedSelect";

import "./EnumInput.scss";

export type EnumInputProps = {
  name: string;
  value: string;
  options: string[] | string;
  onChange: (val: string) => void;
};

export const EnumInput: FC<EnumInputProps> = memo(
  ({ name, value, options, onChange }) => {
    const optionsArray = typeof options === "string" ? [options] : options;
    return optionsArray?.[0] === "colors" ? (
      <div className="EnumInput--color" style={{ backgroundColor: value }}>
        <input
          name={name}
          value={value}
          type="color"
          onChange={(evt) => onChange(evt.target.value)}
          className="EnumInput--color"
        />
      </div>
    ) : (
      <RoundedSelect
        name={name}
        value={value}
        options={(optionsArray.includes(value)
          ? optionsArray
          : [...optionsArray, value]
        ).map((value) => ({ value }))}
        onChange={(evt) => onChange(evt.target.value)}
      />
    );
  }
);
