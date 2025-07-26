import React, { forwardRef } from "react";
import classNames from "classnames";

import { Select } from "./Select";
import { SelectProps } from "./types";

import "./RoundedSelect.css";

export const RoundedSelect = forwardRef<HTMLSelectElement, SelectProps>(
  function RoundedSelect({ className, disabled, ...props }, ref) {
    return (
      <Select
        className={classNames(
          "RoundedSelect",
          { "RoundedSelect--disabled": disabled },
          className,
        )}
        ref={ref}
        disabled={disabled}
        {...props}
      />
    );
  },
);
