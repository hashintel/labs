import React, { FC, useRef } from "react";
import { ExperimentPlanEntry } from "@hashintel/engine-web";

import { ActivityHistoryItemTooltip } from "../ActivityHistoryItemTooltip";
import { AgentHistoryItemIcons } from "../AgentHistoryItemIcons";
import { ExperimentGroupSectionItem } from "./ExperimentGroupSectionItem";
import { SimulationRunId } from "../../SimulationRunId/SimulationRunId";
import { collapseExperimentOrSimulationRunStatus } from "./utils";
import { selectAllSimulationData } from "../../../features/simulator/simulate/selectors";
import {
  simulationComplete,
  simulationViewable,
} from "../../../features/simulator/simulate/util";
import { useFileSize } from "./hooks";
import {
  useRunOpen,
  useSelectRun,
  useSimulationRunContextMenu,
} from "../hooks";
import { useSimulatorSelector } from "../../../features/simulator/context";

import "./ExperimentGroupRun.scss";

export const ExperimentGroupRun: FC<{
  id: string;
  plan: ExperimentPlanEntry;
  experimentFinished: boolean;
  metricOutcome?: number;
}> = ({ id, plan, experimentFinished, metricOutcome }) => {
  const simData = useSimulatorSelector(selectAllSimulationData);
  const open = useRunOpen(id);
  const fields = Object.entries(plan.fields);

  const itemRef = useRef<HTMLDivElement>(null);
  const selectRun = useSelectRun(id);

  const run = simData[id];
  const size = useFileSize(experimentFinished, run);

  /**
   * Finished and viewable are separate because errored cloud runs are
   * "finished" but they're not viewable, as we don't get steps for errored
   * cloud runs. Meanwhile, errored local experiment runs are finished and
   * viewable because we get the steps up until the error
   *
   * finished is used to decide whether to attempt to show a runs file size
   * and whether to allow deleting – as we cannot delete in progress runs
   * as we have no way to abort them.
   *
   * viewable is used to decide whether to allow users to click on a run
   * and view it in the viewer – we cannot do this unless we have steps
   */
  const finished = simulationComplete(run);
  const viewable = simulationViewable(run, finished);

  const [
    onContextMenu,
    exportingTooltip,
    exporting,
  ] = useSimulationRunContextMenu(itemRef, id, viewable);

  if (!run?.steps) {
    return null;
  }

  const tooltip =
    exportingTooltip ??
    (fields.length ||
    (typeof run.metricOutcome !== "undefined" && run.metricOutcome !== null) ? (
      <ActivityHistoryItemTooltip className="ExperimentGroupRunTooltip">
        <ul className="ExperimentGroupRunTooltip__Fields">
          {run.metricOutcome !== undefined && run.metricOutcome !== null ? (
            <li className="ExperimentGroupRunTooltip__Fields__Field ExperimentGroupRunTooltip__Fields__Field--metric">
              <p>
                <span className="ExperimentGroupRunTooltip__Fields__Field__Label">
                  {run.metricName ? `${run.metricName}` : "Outcome"}{" "}
                  <span className="ExperimentGroupRunTooltip__Fields__Field__Badge">
                    METRIC
                  </span>
                </span>
                <span className="ExperimentGroupRunTooltip__Fields__Field__Value">
                  {run.metricOutcome}
                </span>
              </p>
            </li>
          ) : null}
          {fields.map(([name, value]) => (
            <li className="ExperimentGroupRunTooltip__Fields__Field" key={name}>
              <p>
                <span className="ExperimentGroupRunTooltip__Fields__Field__Label">
                  {name}
                </span>
                <span className="ExperimentGroupRunTooltip__Fields__Field__Value">
                  {JSON.stringify(value)}
                </span>
              </p>
            </li>
          ))}
        </ul>
      </ActivityHistoryItemTooltip>
    ) : null);

  const downloading = run.status === "downloading";
  const status = collapseExperimentOrSimulationRunStatus(run.status);

  return (
    <ExperimentGroupSectionItem
      open={open}
      ref={itemRef}
      onClick={selectRun}
      onContextMenu={onContextMenu}
      className="ExperimentGroupRun"
      tooltip={tooltip}
      status={
        status === "completed" &&
        experimentFinished &&
        typeof run.metricOutcome === "number" &&
        run.metricOutcome === metricOutcome
          ? "completedWon"
          : status
      }
      viewable={viewable}
    >
      <SimulationRunId
        id={id}
        className="ExperimentGroupRun__Detail ExperimentGroupRun__Id"
        end
      />
      <div className="ExperimentGroupRun__Detail ExperimentGroupRun__Status">
        {run.status === "queued" ? (
          <>Pending</>
        ) : downloading ? (
          <>Downloading</>
        ) : finished ? (
          <span>{size}</span>
        ) : (
          <>In progress</>
        )}
      </div>
      {
        /**
         * Due to a bug in the engine's integration with Redux, we can't
         * remove experiment runs until they've finished.
         *
         * @todo enable deleting experiment runs whilst in progress
         */
        finished && !downloading ? (
          <AgentHistoryItemIcons id={id} exporting={exporting} />
        ) : null
      }
    </ExperimentGroupSectionItem>
  );
};
