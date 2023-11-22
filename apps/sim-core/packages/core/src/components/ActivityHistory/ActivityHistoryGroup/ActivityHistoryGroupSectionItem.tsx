import React, { forwardRef, ReactNode } from "react";
import classNames from "classnames";

import {
  ActivityHistoryItem,
  ActivityHistoryItemProps,
} from "../ActivityHistoryItem";
import { IconEye } from "../../Icon/Eye";
import { IconEyeOutline } from "../../Icon/EyeOutline";
import { IconLoading } from "../../Icon/Loading";
import { theme } from "../../../util/theme";

import "./ActivityHistoryGroupSectionItem.scss";

export type ActivityHistoryGroupSectionItemProps = DistributiveOmit<
  ActivityHistoryItemProps,
  "label"
> & {
  label?: ReactNode | null;
  loading?: boolean;
};

export const ActivityHistoryGroupSectionItem = forwardRef<
  HTMLElement,
  ActivityHistoryGroupSectionItemProps
>(function ActivityHistoryGroupSectionItem(
  { children, className, open, viewable, loading, label, ...props },
  ref,
) {
  return (
    <ActivityHistoryItem
      className={classNames("ActivityHistoryGroupSectionItem", className)}
      ref={ref}
      open={open}
      viewable={viewable}
      {...props}
    >
      {children}
      {label ? (
        <div className="ActivityHistoryGroupSectionItem__Label">{label}</div>
      ) : null}
      {viewable || open || loading ? (
        <div
          className={classNames(
            "ActivityHistoryGroupSectionItem__ViewingStatus",
            {
              "ActivityHistoryGroupSectionItem__ViewingStatus--open":
                open && !loading,
            },
          )}
        >
          {loading ? (
            /** @todo use classname */
            <div style={{ marginLeft: 3 }}>
              <IconLoading end={theme.black} />
            </div>
          ) : open ? (
            <>
              <IconEye size={16} /> Viewing
            </>
          ) : (
            <>
              <IconEyeOutline size={16} />
              View
            </>
          )}
        </div>
      ) : null}
    </ActivityHistoryItem>
  );
});
