import React, { FC } from "react";
import classNames from "classnames";

import { SimpleTooltip } from "../SimpleTooltip";

import "./ActivityHistoryItemTooltip.scss";

export const ActivityHistoryItemTooltip: FC<{ className?: string }> = ({
  children,
  className,
}) => (
  <SimpleTooltip
    position="below"
    className={classNames("ActivityHistoryItemTooltip", className)}
  >
    {children}
  </SimpleTooltip>
);
