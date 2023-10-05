import React, { ReactNode } from "react";
import SimpleBar from "simplebar-react";
import classNames from "classnames";

import "simplebar-react/dist/simplebar.min.css";
import "./Scrollable.css";

export const Scrollable = ({
  children,
  className,
}: {
  children: (args: { itemClassName: string }) => ReactNode;
  className?: string;
}) => (
  <SimpleBar className={classNames("Scrollable", className)} autoHide={false}>
    {children({ itemClassName: "Scrollable__Item" })}
  </SimpleBar>
);
