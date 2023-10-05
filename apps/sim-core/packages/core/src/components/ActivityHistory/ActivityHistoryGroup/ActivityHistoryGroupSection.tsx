import React, { FC, ReactNode } from "react";
import classNames from "classnames";

import { IconArrowDownDrop } from "../../Icon/ArrowDownDrop";

import "./ActivityHistoryGroupSection.scss";

export const ActivityHistoryGroupSection: FC<
  {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  } & ({ title: ReactNode; loading?: false } | { loading: true; title?: null })
> = ({ open = false, onOpenChange, title, loading, children }) => (
  <div className="ActivityHistoryGroupSection">
    <h3
      className={classNames("ActivityHistoryGroupSection__Header", {
        "ActivityHistoryGroupSection__Header--open": open,
        "ActivityHistoryGroupSection__Header--closed": !open,
        "ActivityHistoryGroupSection__Header--enabled": !!onOpenChange,
        "ActivityHistoryGroupSection__Header--disabled": !onOpenChange,
      })}
      onClick={(evt) => {
        evt.preventDefault();
        onOpenChange?.(!open);
      }}
    >
      {loading ? (
        <div className="ActivityHistoryGroupSection__Header__Loading" />
      ) : (
        <>
          {title}
          {onOpenChange ? <IconArrowDownDrop size={18} /> : null}
        </>
      )}
    </h3>
    <ul className="ActivityHistoryGroupSection__Rows">
      {open ? children : null}
    </ul>
  </div>
);
