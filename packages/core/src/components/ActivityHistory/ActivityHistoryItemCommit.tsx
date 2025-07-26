import React, { FC, useRef } from "react";
import { format } from "date-fns";

import { ActivityHistoryGroupSectionItem } from "./ActivityHistoryGroup/ActivityHistoryGroupSectionItem";
import { ActivityHistoryItemTooltip } from "./ActivityHistoryItemTooltip";
import { CommitWithoutStats } from "../../util/api/queries/commitActions";
import { SimulationRunId } from "../SimulationRunId/SimulationRunId";
import { urlFromProject } from "../../routes";
import { useCurrentRefItem } from "./hooks";
import { useSafeQueryParams } from "../../hooks/useSafeQueryParams";

import "./ActivityHistoryItemCommit.scss";

export const ActivityHistoryItemCommit: FC<{
  pathWithNamespace: string;
  commit: CommitWithoutStats;
}> = ({ pathWithNamespace, commit }) => {
  const date = new Date(commit.createdAt);
  const [queryParams] = useSafeQueryParams();
  const domRef = useRef<HTMLElement>(null);

  const { currentlySwitchingTo, actuallyCurrent, current } = useCurrentRefItem(
    commit.id,
    domRef,
  );

  return (
    <ActivityHistoryGroupSectionItem
      key={commit.id}
      loading={currentlySwitchingTo}
      open={current && actuallyCurrent}
      viewable={!actuallyCurrent && !currentlySwitchingTo}
      as="link"
      path={urlFromProject({
        pathWithNamespace,
        ref: commit.id,
      })}
      query={queryParams}
      label={
        <>
          {format(date, "h:mma")}&nbsp;&nbsp;&nbsp;
          <span title={format(new Date(commit.createdAt), "yyyy/LL/dd h:mma")}>
            <SimulationRunId id={commit.id} />
          </span>
        </>
      }
      ref={domRef}
      tooltip={
        <ActivityHistoryItemTooltip className="ActivityHistoryItemCommitTooltip">
          {commit.message}
        </ActivityHistoryItemTooltip>
      }
    />
  );
};
