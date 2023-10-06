import React, { FC, HTMLProps } from "react";
import classNames from "classnames";

import "./HashCoreFilesListItem.scss";

export const HashCoreFilesListItem: FC<
  HTMLProps<HTMLDivElement> & { depth: number }
> = ({ className, children, depth, style = {}, ...props }) => (
  <div
    className={classNames("HashCoreFilesListItem", className)}
    {...props}
    style={{ ...style, paddingLeft: `${depth}rem` }}
  >
    {children}
  </div>
);
