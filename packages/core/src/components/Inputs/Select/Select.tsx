import React, { forwardRef, useState } from "react";
import classNames from "classnames";

import { IconArrowDownDrop } from "../../Icon/ArrowDownDrop";
import { SelectProps } from "./types";

import "./Select.css";

export const Select = forwardRef<
  HTMLSelectElement,
  Omit<SelectProps, "children">
>(function Select(
  {
    focused,
    onFocusedChange,
    options,
    value,
    defaultValue,
    prefix,
    suffix,
    name,
    disabled,
    className,
    style,
    ...props
  },
  ref,
) {
  const passedValue = defaultValue ?? value;
  const currentValue = options.find((option) => option.value === passedValue);
  const [internalFocused, setInternalFocused] = useState(false);

  const actualFocused = focused ?? internalFocused;
  const actualOnFocusChange = onFocusedChange ?? setInternalFocused;

  return (
    <div
      className={classNames("Select", className, {
        "Select--disabled": disabled,
        "Select--focused": actualFocused,
      })}
      style={style}
    >
      {prefix}
      <span className="Select__Value">
        {currentValue?.selectedDisplayValue ??
          currentValue?.displayValue ??
          currentValue?.value}
      </span>
      {suffix}
      <IconArrowDownDrop size={7.5} />
      {/**
       * We cannot put "disabled" on the select field as it means the
       * default values won't show up in the submission dictionary due to
       * what I believe to be a bug in react-hook-form. Instead, we disable
       * users from selecting any other value other than the current value.
       *
       * @see https://github.com/react-hook-form/react-hook-form/issues/2782
       */}
      <select
        {...props}
        className="Select__select"
        value={value}
        defaultValue={defaultValue}
        tabIndex={disabled ? -1 : undefined}
        onFocus={() => {
          actualOnFocusChange(true);
        }}
        onBlur={() => {
          actualOnFocusChange(false);
        }}
        ref={ref}
        name={name}
      >
        {options.map((opt) => (
          <option
            value={opt.value}
            key={opt.value}
            disabled={opt.disabled ?? disabled ? opt.value !== value : false}
          >
            {opt.displayValue ?? opt.value}
          </option>
        ))}
      </select>
    </div>
  );
});
