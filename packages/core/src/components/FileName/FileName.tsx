import React, { forwardRef, HTMLProps } from "react";
import classNames from "classnames";

import "./FileName.scss";

export const FileName = forwardRef<HTMLDivElement, HTMLProps<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div className={classNames("FileName", className)} {...props} ref={ref}>
      {children}
    </div>
  ),
);
