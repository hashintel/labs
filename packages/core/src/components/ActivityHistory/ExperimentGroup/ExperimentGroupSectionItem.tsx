import React, { forwardRef, useState } from "react";
import classNames from "classnames";

import {
  ActivityHistoryGroupSectionItem,
  ActivityHistoryGroupSectionItemProps,
} from "../ActivityHistoryGroup/ActivityHistoryGroupSectionItem";
import { ExperimentGroupIconDots } from "./ExperimentGroupIconDots";
import { ExperimentGroupSectionItemStatus } from "./utils";
import { IconAlert, IconPackageDown } from "../../Icon";
import { IconCheck } from "../../Icon/Check";
import { LazyIconLoading } from "../../Icon/Loading/LazyIconLoading";
import { theme } from "../../../util/theme";

import "./ExperimentGroupSectionItem.scss";

export const ExperimentGroupSectionItem = forwardRef<
  HTMLDivElement,
  DistributiveOmit<
    ActivityHistoryGroupSectionItemProps,
    "onMouseEnter" | "onMouseLeave"
  > & {
    status: ExperimentGroupSectionItemStatus;
  }
>(({ children, className, status, ...props }, ref) => {
  const [hovered, setHovered] = useState(false);

  return (
    <ActivityHistoryGroupSectionItem
      className={classNames("ExperimentGroupSectionItem", className)}
      ref={ref}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      {...props}
    >
      <div className="ExperimentGroupSectionItem__Icon">
        {status === "errored" ? (
          <IconAlert />
        ) : status === "completed" ? (
          <IconCheck size={16} />
        ) : status === "completedWon" ? (
          <div className="ExperimentGroupSectionItem__Icon__CompletedWon">
            <IconCheck size={12} />
          </div>
        ) : status === "downloading" ? (
          <IconPackageDown size={16} />
        ) : (
          <>
            {status === "queued" ? <ExperimentGroupIconDots /> : null}
            {/**
             * We always render this because we want them to all be in sync
             * by the time they render. We hide it with CSS instead
             */}
            <LazyIconLoading
              end={hovered ? theme["dark-hover"] : theme.black}
            />
          </>
        )}
      </div>
      {children}
    </ActivityHistoryGroupSectionItem>
  );
});
