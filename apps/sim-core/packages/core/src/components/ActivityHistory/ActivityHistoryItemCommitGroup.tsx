import React, { FC } from "react";
import { EntityId } from "@reduxjs/toolkit";

import { ActivityHistoryGroup } from "./ActivityHistoryGroup/ActivityHistoryGroup";
import { ActivityHistoryGroupSection } from "./ActivityHistoryGroup/ActivityHistoryGroupSection";
import { ActivityHistoryGroupTitle } from "./ActivityHistoryGroup/ActivityHistoryGroupTitle";
import { ActivityHistoryItemCommit } from "./ActivityHistoryItemCommit";
import { ActivityTime } from "./ActivityTime";
import { SimulatorHistoryItemCommitGroup } from "../../features/simulator/simulate/types";
import { selectHistoryCurrentCommitGroup } from "../../features/simulator/simulate/selectors";
import { toggleCommitGroup } from "../../features/simulator/simulate/slice";
import { useProject } from "../../features/project/ProjectContext";
import {
  useSimulatorDispatch,
  useSimulatorSelector,
} from "../../features/simulator/context";

export const ActivityHistoryItemCommitGroup: FC<{
  item: SimulatorHistoryItemCommitGroup["item"];
  historyId: EntityId;
  createdAt: number;
}> = ({ historyId, item, createdAt }) => {
  const { commits } = item;

  const open =
    useSimulatorSelector(selectHistoryCurrentCommitGroup) === historyId;
  const { currentProject } = useProject();
  const pathWithNamespace = currentProject?.pathWithNamespace;
  if (!pathWithNamespace) {
    throw new Error("Project does not exist when it is required");
  }
  const simDispatch = useSimulatorDispatch();

  return (
    <ActivityHistoryGroup
      open={open}
      onClick={() => {
        simDispatch(toggleCommitGroup(historyId));
      }}
      after={
        <ActivityHistoryGroupSection title="Commits" open>
          {commits.map((commit) => (
            <ActivityHistoryItemCommit
              pathWithNamespace={pathWithNamespace}
              commit={commit}
              key={commit.id}
            />
          ))}
        </ActivityHistoryGroupSection>
      }
    >
      <ActivityHistoryGroupTitle canOpen>
        {item.recents ? (
          <>Recent edits</>
        ) : (
          <>
            {commits.length} edit{commits.length === 1 ? null : "s"}
          </>
        )}
      </ActivityHistoryGroupTitle>
      <ActivityTime time={createdAt} />
    </ActivityHistoryGroup>
  );
};
