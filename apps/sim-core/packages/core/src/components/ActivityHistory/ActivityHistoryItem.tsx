import React, { forwardRef, HTMLProps, ReactNode } from "react";
import classNames from "classnames";

import { Link, LinkProps } from "../Link/Link";

import "./ActivityHistoryItem.scss";

interface ActivityHistoryItemPropsShared {
  open?: boolean;
  tooltip?: ReactNode | null;
  viewable?: boolean;
  after?: ReactNode | null;
}

type ActivityHistoryItemPropsDiv = ActivityHistoryItemPropsShared &
  Omit<HTMLProps<HTMLDivElement>, "ref" | "as">;

type ActivityHistoryItemPropsLink = ActivityHistoryItemPropsShared &
  Omit<LinkProps, "onClick" | "as">;

export type ActivityHistoryItemProps =
  | ({ as?: "div" | undefined } & ActivityHistoryItemPropsDiv)
  | ({ as: "link" } & ActivityHistoryItemPropsLink);

export const ActivityHistoryItem = forwardRef<
  HTMLElement,
  ActivityHistoryItemProps
>(function ActivityHistoryItem(
  {
    open = false,
    className,
    children,
    tooltip,
    viewable = true,
    after = null,
    ...props
  },
  ref,
) {
  const { as, ...otherProps } = props;
  const Component = as === "link" ? Link : "div";

  return (
    <li
      className={classNames("ActivityHistoryItem", {
        "ActivityHistoryItem--open": open,
      })}
    >
      <Component
        className={classNames(
          "ActivityHistoryItem__Row",
          {
            "ActivityHistoryItem__Row--tooltip": !!tooltip && viewable,
            "ActivityHistoryItem__Row--viewable": viewable,
          },
          className,
        )}
        ref={ref as any}
        {...(otherProps as any)}
        onClick={
          "onClick" in otherProps
            ? (evt: React.MouseEvent<any, MouseEvent>) => {
                evt.preventDefault();
                if (viewable) {
                  otherProps.onClick?.(evt);
                }
              }
            : undefined
        }
      >
        {viewable ? tooltip : null}
        {children}
      </Component>
      {open ? after : null}
    </li>
  );
});
