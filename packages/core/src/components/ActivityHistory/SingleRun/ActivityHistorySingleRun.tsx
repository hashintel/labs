import React, { FC, useMemo, useRef } from "react";
import { createSelector } from "@reduxjs/toolkit";

import { ActivityHistoryItem } from "../ActivityHistoryItem";
import { ActivityTime } from "../ActivityTime";
import { AgentHistoryItemIcons } from "../AgentHistoryItemIcons";
import { SimulationRunId } from "../../SimulationRunId/SimulationRunId";
import { formatNumber } from "../../../util/formatNumber";
import { selectAllSimulationData } from "../../../features/simulator/simulate/selectors";
import {
  useRunOpen,
  useSelectRun,
  useSimulationRunContextMenu,
} from "../hooks";
import { useSimulatorSelector } from "../../../features/simulator/context";

import "./ActivityHistorySingleRun.scss";

const makeSelectSingleRun = (runId: string) =>
  createSelector(selectAllSimulationData, (data) => {
    const run = data[runId];

    if (!run) {
      throw new Error("Data missing for run");
    }

    return run;
  });

export const ActivityHistorySingleRun: FC<{
  id: string;
}> = ({ id }) => {
  const singleRunSelector = useMemo(() => makeSelectSingleRun(id), [id]);
  const run = useSimulatorSelector(singleRunSelector);
  const itemRef = useRef<HTMLDivElement>(null);
  const selectRun = useSelectRun(id);
  const open = useRunOpen(id);

  const [onContextMenu, exportingTooltip, exporting] =
    useSimulationRunContextMenu(itemRef, id);

  return (
    <ActivityHistoryItem
      open={open}
      ref={itemRef}
      className="ActivityHistorySingleRun"
      onClick={selectRun}
      onContextMenu={onContextMenu}
      tooltip={exportingTooltip ?? null}
    >
      <span className="ActivityHistorySingleRun__Details">
        <span className="ActivityHistorySingleRun__Name">
          {formatNumber(run.stepsCount)} step run
        </span>
        <SimulationRunId id={id} className="ActivityHistorySingleRun__Id" />
      </span>
      <ActivityTime time={run.startedTime} />
      <AgentHistoryItemIcons id={id} exporting={exporting} />
    </ActivityHistoryItem>
  );
};
