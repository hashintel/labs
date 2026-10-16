import React, { FC, PropsWithChildren } from "react";
import classnames from "classnames";

import {
  ActivityHistoryItem,
  ActivityHistoryItemProps,
} from "../ActivityHistoryItem";

import "./ActivityHistoryGroup.scss";

export const ActivityHistoryGroup: FC<
  PropsWithChildren<ActivityHistoryItemProps>
> = ({ className, children, open, ...props }) => (
  <ActivityHistoryItem
    {...props}
    open={open}
    className={classnames(className, "ActivityHistoryGroup", {
      "ActivityHistoryGroup--closed": !open,
    })}
  >
    {children}
  </ActivityHistoryItem>
);
