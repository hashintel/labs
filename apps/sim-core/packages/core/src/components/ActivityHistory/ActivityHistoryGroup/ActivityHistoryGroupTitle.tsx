import React, { FC } from "react";

import { ActivityHistoryRowSpacer } from "../ActivityHistoryRowSpacer";
import { IconArrowDownDrop } from "../../Icon/ArrowDownDrop";

import "./ActivityHistoryGroupTitle.scss";

export const ActivityHistoryGroupTitle: FC<{ canOpen: boolean }> = ({
  canOpen,
  children,
}) => (
  <>
    <div className="ActivityHistoryGroupTitle__Name">{children}</div>
    {canOpen ? (
      <div className="ActivityHistoryGroupTitle__Arrow">
        <IconArrowDownDrop size={18} />
      </div>
    ) : null}
    <ActivityHistoryRowSpacer />
  </>
);
