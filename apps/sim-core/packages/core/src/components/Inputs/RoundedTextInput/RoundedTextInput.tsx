import React, { forwardRef, InputHTMLAttributes } from "react";
import classnames from "classnames";

import "./RoundedTextInput.css";

export type RoundedTextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  inputClassName?: string;
};

/**
 * Using a named function so the name shows up in dev tools despite forwardRef
 */
export const RoundedTextInput = forwardRef<
  HTMLInputElement,
  RoundedTextInputProps
>(function RoundedText({ children, className, inputClassName, ...props }, ref) {
  return (
    <div className={classnames("RoundedTextInput", className)}>
      <input
        type="text"
        ref={ref}
        className={classnames("RoundedTextInput__input", inputClassName)}
        {...props}
      />
      {children}
    </div>
  );
});
