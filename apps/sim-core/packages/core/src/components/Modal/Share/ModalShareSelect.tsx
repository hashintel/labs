import React, { forwardRef } from "react";
import classNames from "classnames";

import { RoundedSelect } from "../../Inputs/Select/RoundedSelect";
import { SelectProps } from "../../Inputs/Select/types";

import "./ModalShareSelect.scss";

export const ModalShareSelect = forwardRef<HTMLSelectElement, SelectProps>(
  function ModalShareSelect({ className, ...props }, ref) {
    return (
      <RoundedSelect
        className={classNames("ModalShareSelect", className)}
        ref={ref}
        {...props}
      />
    );
  },
);
