import React, { FC, useCallback, useEffect, useMemo, useState } from "react";
import { createSelector } from "@reduxjs/toolkit";

import { ActivityHistoryGroup } from "../ActivityHistoryGroup/ActivityHistoryGroup";
import { ActivityHistoryGroupTitle } from "../ActivityHistoryGroup/ActivityHistoryGroupTitle";
import { ActivityTime } from "../ActivityTime";
import { AgentHistoryItemIcons } from "../AgentHistoryItemIcons";
import {
  EXPERIMENT_PENDING_THRESHOLD,
  experimentRunInitialized,
  hasExperimentFinished,
  simulationViewable,
} from "../../../features/simulator/simulate/util";
import { ExperimentGroupSections } from "./ExperimentGroupSections";
import { IconAlert } from "../../Icon";
import { IconCloud } from "../../Icon/Cloud/IconCloud";
import { LazyIconLoading } from "../../Icon/Loading/LazyIconLoading";
import { SimulatorRootState } from "../../../features/simulator/types";
import { openExperiment } from "../../../features/simulator/simulate/thunks";
import {
  selectAllSimulationData,
  selectCurrentExperimentId,
  selectExperimentRuns,
  selectPendingExperimentRuns,
} from "../../../features/simulator/simulate/selectors";
import { theme } from "../../../util/theme";
import {
  useSimulatorDispatch,
  useSimulatorSelector,
} from "../../../features/simulator/context";

import "./ExperimentGroup.scss";

/**
 * We have a budget of 100ms within which if we don't show the experiment
 * until it is no longer pending, a user won't notice a lag – but if we did
 * show the experiment and then immediately swapped to a non-pending experiment
 * it would be disorientating. So we wait 100ms with pending experiments
 * before rendering them. Concurrent mode would make this easier…
 */
const useReadyToShowExperiment = (
  selected: boolean,
  pending: boolean,
  startedTime: number
) => {
  const alreadyReady =
    selected ||
    !pending ||
    Date.now() - startedTime >= EXPERIMENT_PENDING_THRESHOLD;
  const [ready, setReady] = useState(alreadyReady);

  if (alreadyReady && !ready) {
    setReady(true);
  }

  useEffect(() => {
    if (pending && !ready) {
      /**
       * This is the length of time since the experiment was created that we
       * have left for the experiment to no longer be pending, before we show
       * a pending UI
       */
      const ms = EXPERIMENT_PENDING_THRESHOLD - (Date.now() - startedTime);

      /**
       * In most JS environments, 4ms is the minimum wait time – so we should
       * become ready immediately if its less than 4ms.
       */
      if (ms > 4) {
        const timeout = setTimeout(() => {
          setReady(true);
        }, ms);

        return () => {
          clearTimeout(timeout);
        };
      } else {
        setReady(true);
      }
    }
  }, [ready, pending, startedTime]);

  return ready;
};

const emptySimIds: string[] = [];

const makeSelectExperimentById = (id: string) =>
  createSelector(
    [selectExperimentRuns, selectPendingExperimentRuns],
    (experiments, pendingExperiments) => {
      const experimentRun = experiments[id] ?? pendingExperiments[id];

      if (!experimentRun) {
        throw new Error("data missing for experiment");
      }

      return experimentRun;
    }
  );

export const ExperimentGroup: FC<{
  id: string;
}> = ({ id }) => {
  const selector = useMemo(() => makeSelectExperimentById(id), [id]);
  const data = useSimulatorSelector(selector);

  const simDispatch = useSimulatorDispatch();
  const open =
    useSimulatorSelector(selectCurrentExperimentId) === data.experimentId;
  const experimentFinished = hasExperimentFinished(data.status);

  const pending = !experimentRunInitialized(data);
  const readyToShow = useReadyToShowExperiment(open, pending, data.startedTime);

  const [hovered, setHovered] = useState(false);

  const simIds = experimentRunInitialized(data)
    ? data.simulationIds
    : emptySimIds;

  const anySimsViewableSelector = useCallback(
    (state: SimulatorRootState) => {
      const simData = selectAllSimulationData(state);

      return simIds.some((id) => simulationViewable(simData[id]));
    },
    [simIds]
  );

  const anySimsViewable = useSimulatorSelector(anySimsViewableSelector);

  if (!readyToShow) {
    return null;
  }

  const experimentFailed = data.status === "errored";
  const experimentPendingAndFailed = pending && experimentFailed;

  return (
    <ActivityHistoryGroup
      open={open}
      className="ExperimentGroup"
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      viewable={!experimentPendingAndFailed}
      onClick={() => {
        simDispatch(openExperiment(open ? null : data.experimentId));
      }}
      after={
        experimentPendingAndFailed ? null : (
          <ExperimentGroupSections
            data={data}
            simIds={simIds}
            anySimsViewable={anySimsViewable}
          />
        )
      }
    >
      <ActivityHistoryGroupTitle canOpen={!experimentPendingAndFailed}>
        {data.experimentName}
      </ActivityHistoryGroupTitle>
      {experimentFailed ? (
        <span className="ExperimentGroup__StatusIcon">
          <IconAlert size={16} />
        </span>
      ) : (
        <>
          {experimentFinished ? null : (
            <span className="ExperimentGroup__StatusIcon">
              <LazyIconLoading
                end={
                  /**
                   * @todo remove this when LazyIconLoading can detect its own
                   *       end color
                   */
                  open
                    ? hovered
                      ? theme["dark-hover-hover"]
                      : theme["black"]
                    : hovered
                    ? theme["dark-hover"]
                    : theme["dark"]
                }
              />
            </span>
          )}
          {data.target === "cloud" ? (
            <span className="ExperimentGroup__StatusIcon ExperimentGroup__StatusIcon--cloud">
              <IconCloud size={12} />
            </span>
          ) : null}
        </>
      )}
      <ActivityTime time={data.startedTime} />
      {experimentFinished ? (
        <AgentHistoryItemIcons
          id={data.experimentId}
          experimentGroup
          canDelete={data.target !== "cloud" || experimentPendingAndFailed}
        />
      ) : null}
    </ActivityHistoryGroup>
  );
};
