import React, { FC, useRef, useState } from "react";
import { ExperimentDefinition, ExperimentRun } from "@hashintel/engine-web";

import { ActivityHistoryGroupSection } from "../ActivityHistoryGroup/ActivityHistoryGroupSection";
import { ActivityHistoryGroupSectionItem } from "../ActivityHistoryGroup/ActivityHistoryGroupSectionItem";
import { AnalysisMode } from "../../../features/simulator/simulate/enum";
import { AnyExperimentRun } from "../../../features/simulator/simulate/types";
import { ExperimentGroupRun } from "./ExperimentGroupRun";
import { ExperimentGroupSectionItem } from "./ExperimentGroupSectionItem";
import { ExperimentGroupSectionItemStatus } from "./utils";
import {
  experimentRunInitialized,
  hasExperimentFinished,
  simulationHasSteps,
} from "../../../features/simulator/simulate/util";
import {
  selectAllSimulationData,
  selectAnalysisMode,
} from "../../../features/simulator/simulate/selectors";
import { showCollatedAnalysisForExperiment } from "../../../features/simulator/simulate/slice";
import { useExperimentRunContextMenu } from "../hooks";
import {
  useSimulatorDispatch,
  useSimulatorSelector,
} from "../../../features/simulator/context";

const ExperimentGroupAnalysisSection: FC<{
  anySimsViewable: boolean;
  data: AnyExperimentRun;
}> = ({ anySimsViewable, data }) => {
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const analysisMode = useSimulatorSelector(selectAnalysisMode);
  const simDispatch = useSimulatorDispatch();

  /**
   * @todo abstract this
   */
  const readyForAnalysis = useSimulatorSelector((state) => {
    if (!experimentRunInitialized(data)) {
      return false;
    }

    const simData = selectAllSimulationData(state);

    return data.simulationIds.every(
      (id) =>
        !!simData[id]?.analysis ||
        !!simData[id]?.plots ||
        simulationHasSteps(simData[id]),
    );
  });

  /**
   * Unfortunately, the earliest that we can be sure across all types of
   * experiments that we have all of the analysis is once we've received the
   * stopping message, and we've also received analysis links for all runs.
   * Realistically, we'll have received all the data we need a fair while before
   * that, but we can't see into the future, so the only we know is when we're
   * told that nothing more is coming.
   *
   * @todo We can treat non-optimization experiments differently, as we're told
   *       about all of the runs for those experiments in the first run.
   */
  const analysisStatus: ExperimentGroupSectionItemStatus =
    data.status === "completed" || data.status === "stopping"
      ? readyForAnalysis
        ? "completed"
        : "running"
      : data.status;

  const analysisViewable = anySimsViewable && analysisStatus === "completed";

  const allRunItemRef = useRef<HTMLDivElement>(null);

  const [onContextMenu, exportingTooltip] = useExperimentRunContextMenu(
    allRunItemRef,
    data.experimentId,
    analysisViewable,
  );

  return (
    <ActivityHistoryGroupSection
      open={analysisOpen}
      onOpenChange={setAnalysisOpen}
      title="Experiment analysis"
    >
      <ExperimentGroupSectionItem
        open={analysisMode === AnalysisMode.ExperimentCollated}
        status={analysisStatus}
        viewable={analysisViewable}
        onClick={() => {
          simDispatch(showCollatedAnalysisForExperiment(data.experimentId));
        }}
        onContextMenu={onContextMenu}
        label={<>All Runs (Collated View)</>}
        ref={allRunItemRef}
        tooltip={exportingTooltip}
      />
    </ActivityHistoryGroupSection>
  );
};

type OptimizationDefinition = Extract<
  ExperimentDefinition,
  { type: "optimization" }
>;

export const ExperimentGroupSections: FC<{
  data: AnyExperimentRun;
  simIds: string[];
  anySimsViewable: boolean;
}> = ({ data, simIds, anySimsViewable }) => {
  const [rowsOpen, setRowsOpen] = useState(false);
  const [optimizerOpen, setOptimizerOpen] = useState(false);

  const runCount = simIds.length;

  const initializedData: ExperimentRun | null = experimentRunInitialized(data)
    ? data
    : null;

  const optimizationExperiment: OptimizationDefinition | null =
    data.definition.type === "optimization" ? data.definition : null;

  return (
    <>
      <ExperimentGroupAnalysisSection
        anySimsViewable={anySimsViewable}
        data={data}
      />
      {initializedData ? (
        <>
          {optimizationExperiment ? (
            <ActivityHistoryGroupSection
              title="Objective"
              open={optimizerOpen}
              onOpenChange={setOptimizerOpen}
            >
              <ActivityHistoryGroupSectionItem viewable={false}>
                <em>
                  {optimizationExperiment.metricObjective === "max"
                    ? "maximize"
                    : "minimize"}
                </em>
                &nbsp;
                {optimizationExperiment.metricName}
              </ActivityHistoryGroupSectionItem>
            </ActivityHistoryGroupSection>
          ) : null}
          <ActivityHistoryGroupSection
            title={
              <>
                {runCount} Individual run{runCount === 1 ? null : "s"}
              </>
            }
            open={rowsOpen}
            onOpenChange={setRowsOpen}
          >
            {simIds.map((id) => (
              <ExperimentGroupRun
                key={id}
                id={id}
                plan={initializedData.plan[id]}
                experimentFinished={hasExperimentFinished(
                  initializedData.status,
                )}
                metricOutcome={initializedData.metricOutcome}
              />
            ))}
          </ActivityHistoryGroupSection>
        </>
      ) : (
        <>
          {optimizationExperiment ? (
            <ActivityHistoryGroupSection loading />
          ) : null}
          <ActivityHistoryGroupSection loading />
        </>
      )}
    </>
  );
};
