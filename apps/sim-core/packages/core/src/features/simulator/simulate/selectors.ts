import { createSelector, Selector } from "@reduxjs/toolkit";

import { AnalysisMode } from "./enum";
import type { SimulationData, SimulatorSlice } from "./types";
import type { SimulatorRootState } from "../types";
import {
  defaultSimulationData,
  minimumAvailableStep,
  simulationComplete,
} from "./util";
import { historyAdapter } from "./historyAdapter";

const selectSimulatorSlice: Selector<SimulatorRootState, SimulatorSlice> = (
  state,
) => state.simulator;

export const selectAllSimulationData = createSelector(
  selectSimulatorSlice,
  (simulator) => simulator.simulationData,
);

export const selectExperimentRuns = createSelector(
  selectSimulatorSlice,
  (simulator) => simulator.experimentRuns,
);

export const selectPendingExperimentRuns = createSelector(
  selectSimulatorSlice,
  (simulator) => simulator.pendingExperimentRuns,
);

export const selectAllExperimentSimulationRunIds = createSelector(
  selectExperimentRuns,
  (runs) => Object.values(runs).flatMap((run) => run.simulationIds),
);

export const selectAllSingleRuns = createSelector(
  selectAllSimulationData,
  (simdata) => Object.values(simdata).filter((run) => !run.experimentId),
);

const selectNullableCurrentSimulationId = createSelector(
  selectSimulatorSlice,
  (simulator) => simulator.currentSimulation,
);

export const selectHasCurrentSimulation = createSelector(
  [selectNullableCurrentSimulationId, selectAllSimulationData],
  (id, data) => id && !!data[id],
);

export const selectCurrentSimulationData = createSelector(
  [selectNullableCurrentSimulationId, selectAllSimulationData],
  (currentSimulation, simulationData): SimulationData =>
    (currentSimulation ? simulationData[currentSimulation] : null) ??
    defaultSimulationData,
);

export const selectCurrentSimulationId = createSelector(
  selectCurrentSimulationData,
  (sim) => sim.simulationRunId,
);

export const selectCurrentExperimentId = createSelector(
  selectSimulatorSlice,
  (slice) => slice.selectedExperimentId,
);

export const selectCurrentExperimentData = createSelector(
  [selectCurrentExperimentId, selectExperimentRuns],
  (experimentId, runs) => (experimentId ? runs[experimentId] ?? null : null),
);

export const selectCurrentExperimentName = createSelector(
  selectCurrentExperimentData,
  (data) => data?.experimentName ?? null,
);

export const selectPyodideStatus = createSelector(
  selectSimulatorSlice,
  (status) => status.pyodideStatus,
);

export const selectRunning = createSelector(
  selectCurrentSimulationData,
  (runner) => runner.status === "running",
);

export const selectResetting = createSelector(
  selectSimulatorSlice,
  (slice) => slice.resetting,
);

export const selectCurrentRunnerSteps = createSelector(
  selectCurrentSimulationData,
  (sim) => sim.steps,
);

/**
 * @warning you probably want selectCurrentRunnerNumSteps
 */
const selectCurrentRunnerStepsCount = createSelector(
  selectCurrentSimulationData,
  (sim) => sim.stepsCount,
);

export const selectCurrentRunnerHasSteps = createSelector(
  selectCurrentRunnerStepsCount,
  (numSteps) => numSteps > 1,
);

/**
 * @todo this actually selects the max step index. steps start at 0
 *    this is why the max scrubbable step is the stepsCount - 1
 *    rename this.
 */
export const selectCurrentRunnerNumSteps = createSelector(
  selectCurrentRunnerStepsCount,
  (count) => Math.max(0, count - 1),
);

/**
 * Select the lowest step index for which state data are available,
 *    based on the simulation's step data retention policy.
 */
export const selectCurrentRunnerMinStep = createSelector(
  selectCurrentSimulationData,
  (sim) => minimumAvailableStep(sim),
);

export const selectScrubbedStep = createSelector(
  selectCurrentSimulationData,
  (sim) => sim.scrubbedStep,
);

export const selectTrackingFinalStep = createSelector(
  selectScrubbedStep,
  (step) => step === null,
);

export const selectCurrentStep = createSelector(
  [selectTrackingFinalStep, selectCurrentRunnerNumSteps, selectScrubbedStep],
  (trackingFinalStep, numSteps, scrubbedStep) =>
    trackingFinalStep || numSteps === 0 || scrubbedStep! >= numSteps
      ? numSteps
      : scrubbedStep!,
);

export const selectPresentingSpeed = createSelector(
  selectCurrentSimulationData,
  (sim) => sim.presentingSpeed,
);

export const selectPresenting = createSelector(
  selectCurrentSimulationData,
  (sim) => sim.presenting,
);

export const selectCurrentSimMode = createSelector(
  selectCurrentSimulationData,
  (sim) => sim.mode,
);

export const selectCurrentSimStepRetention = createSelector(
  selectCurrentSimulationData,
  (sim) => sim.stepRetention,
);

export const selectCanCurrentSimCompute = createSelector(
  selectCurrentSimMode,
  (mode) => mode === "computeAndPlayback",
);

export const selectCurrentSimComplete = createSelector(
  selectCurrentSimulationData,
  simulationComplete,
);

export const selectCurrentSimErrored = createSelector(
  selectCurrentSimulationData,
  (sim) => sim.status === "errored",
);

export const selectCanPlayPause = createSelector(
  [
    selectHasCurrentSimulation,
    selectResetting,
    selectCurrentSimComplete,
    selectCurrentSimMode,
    selectPyodideStatus,
  ],
  (hasSimulation, resetting, complete, mode, pyodide) =>
    hasSimulation &&
    !resetting &&
    !complete &&
    mode !== "historic" &&
    pyodide !== "errored",
);

export const selectCanPresent = createSelector(
  [
    selectCurrentRunnerHasSteps,
    selectResetting,
    selectScrubbedStep,
    selectCurrentRunnerNumSteps,
  ],
  (hasSteps, resetting, step, count) =>
    hasSteps && !resetting && step !== null && step < count,
);

export const selectProviderTarget = createSelector(
  [selectSimulatorSlice],
  (slice) => (slice.cloudDisabled ? "web" : slice.selectedTarget),
);

export const selectCanRunExperiment = createSelector(
  [selectResetting, selectPyodideStatus, selectProviderTarget],
  (resetting, pyodide, target) =>
    !resetting && (target === "cloud" || pyodide !== "errored"),
);

export const selectAnalysisMode = createSelector(
  selectSimulatorSlice,
  (slice) => slice.analysisMode,
);

/**
 * @warning you probably don't need this – unless you only have access to
 *          simulator state
 * @see     selectCurrentTab
 */
export const selectAnalysisTabVisibleInSimulator = createSelector(
  selectSimulatorSlice,
  (slice) => slice.analysisVisible,
);

export const selectSimulationIdsForAnalysisMode = createSelector(
  [selectAnalysisMode, selectCurrentSimulationId, selectCurrentExperimentData],
  (analysisMode, simulationId, experiment) => {
    switch (analysisMode) {
      case AnalysisMode.SingleRun:
        return simulationId ? [simulationId] : [];
      case AnalysisMode.ExperimentCollated:
        return experiment?.simulationIds ?? [];
    }

    return [];
  },
);

export const selectHistory = createSelector(
  selectSimulatorSlice,
  (slice) => slice.history,
);

export const selectHistoryNextPage = createSelector(
  selectHistory,
  (history) => history.nextPage,
);

export const selectHistoryComplete = createSelector(
  selectHistory,
  (history) => history.complete,
);

export const selectHistoryReceivedCurrent = createSelector(
  selectHistory,
  (history) => history.receivedCurrent,
);

export const selectHistoryHasFilledScreen = createSelector(
  selectHistory,
  (history) => history.haveFilledScreen,
);

export const selectHistoryProject = createSelector(
  selectHistory,
  (history) => history.project,
);

export const selectHistoryReady = createSelector(
  selectHistoryProject,
  (project) => project !== null,
);

export const selectHistoryRequestingMore = createSelector(
  selectHistory,
  (history) => history.requestingMore,
);

/**
 * Does not actually control visibility
 *
 * @see SimulatorHistory["visible"]
 */
export const selectHistoryVisible = createSelector(
  [selectHistory],
  (history) => history.visible,
);

export const selectHistoryCurrentCommitGroup = createSelector(
  [selectHistory],
  (history) => history.selectedCommitGroup,
);

export const historySelectors = historyAdapter.getSelectors(selectHistory);
