import React, { forwardRef, ReactNode } from "react";
import classnames from "classnames";

import { HashCoreFilesSearchFade } from "./HashCoreFilesSearchFade";
import {
  RoundedTextInput,
  RoundedTextInputProps,
} from "../../../Inputs/RoundedTextInput";

import "./HashCoreFilesSearchInput.css";

/**
 * Using a named function so the name shows up in dev tools despite forwardRef
 */
export const HashCoreFilesSearchInput = forwardRef<
  HTMLInputElement,
  RoundedTextInputProps & { icons: ReactNode }
>(function SearchInput({ icons, className, ...props }, ref) {
  return (
    <RoundedTextInput
      className={classnames("HashCoreFilesSearchInput", className)}
      ref={ref}
      {...props}
    >
      <div className="HashCoreFilesSearchInput__Icons">
        <HashCoreFilesSearchFade />
        {icons}
      </div>
    </RoundedTextInput>
  );
});
