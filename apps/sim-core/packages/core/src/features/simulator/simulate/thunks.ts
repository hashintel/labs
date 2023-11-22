import { ProviderTargetEnv } from "@hashintel/engine-web";

import { AnyExperimentRun, SimulationData } from "./types";
import { LinkableProject, ProjectAccess } from "../../project/types";
import { Scope, selectScope } from "../../scopes";
import type { SimulatorThunk } from "../types";
import { addUserAlert } from "../../viewer";
import { store as appStore } from "../../store";
import {
  createCompleteManifest,
  experimentRunInitialized,
  getSimAndTarget,
  parseStopMessage,
  runnerMessage,
  simulationComplete,
} from "./util";
import { historicCloudExperimentProvider } from "../historicCloudExperimentProvider";
import {
  pauseSimulator,
  prepareForNewProject,
  present,
  removeSimulationData,
  resetViewer,
  resumeSimulator,
  setExperimentSteps,
  setPresentingSpeed,
  setProviderTarget,
  setSelectedExperiment,
  setSelectedSimulation,
  setSimulationAnalysis,
  setSimulationStatus,
  updateHistory,
} from "./slice";
import { projectHistory } from "../../../util/api/queries/projectHistory";
import { pyodideEnabled } from "../../../util/pyodideEnabled";
import {
  selectAllSimulationData,
  selectAllSingleRuns,
  selectCanCurrentSimCompute,
  selectCanPresent,
  selectCurrentSimulationId,
  selectExperimentRuns,
  selectHistoryNextPage,
  selectHistoryReceivedCurrent,
  selectPendingExperimentRuns,
} from "./selectors";
import {
  selectCurrentProjectUrl,
  selectRefIsNotCommit,
} from "../../project/selectors";
import { setLocalStorageSimulatorTarget } from "./target";
import { simulationProvider } from "./buildprovider";

export const initializeNewRun =
  (firstRun = false): SimulatorThunk<Promise<void>> =>
  async (dispatch) => {
    const appState = appStore.getState();
    const outSimulationSrc = createCompleteManifest(appState);

    // @todo reimplement this
    const projectUrl = selectCurrentProjectUrl(appState);
    if (projectUrl) {
      dispatch(resetViewer());
      const resp = await runnerMessage(
        {
          type: "initialize",
          presetRunId: null,
          manifestSrc: JSON.stringify(outSimulationSrc),
          numSteps: 0,
          includeSteps: true,
          pyodideEnabled: pyodideEnabled(),
        },
        "",
      );

      if (resp.simulationRunId) {
        const shouldSelect =
          !firstRun || selectRefIsNotCommit(appStore.getState());

        dispatch(
          setSelectedSimulation({
            simId: resp.simulationRunId,
            latest: true,
            selected: shouldSelect,
          }),
        );
      }
    }
  };

export const pauseAndNew =
  (firstRun?: boolean): SimulatorThunk<Promise<void>> =>
  async (dispatch) => {
    dispatch(pauseSimulator());
    await dispatch(initializeNewRun(firstRun));
  };

export const fetchProjectHistory =
  (
    project: LinkableProject,
    access: ProjectAccess,
    pageToCurrent: boolean,
    createdBefore?: string | null,
    signal?: AbortSignal,
  ): SimulatorThunk<Promise<void>> =>
  async (dispatch) => {
    const history = await projectHistory(
      project,
      pageToCurrent,
      createdBefore,
      access?.code,
      signal,
    );

    if (!signal?.aborted) {
      dispatch(updateHistory({ history, project }));
    }
  };

/**
 * This shouldn't take a project, because it relies on reading from state for
 * other required info – should store the project history corresponds to and use
 * that instead
 */
export const fetchProjectHistoryNextPage =
  (
    project: LinkableProject,
    access: ProjectAccess,
    signal?: AbortSignal,
  ): SimulatorThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const state = getState();
    await dispatch(
      fetchProjectHistory(
        project,
        access,
        !selectHistoryReceivedCurrent(state),
        selectHistoryNextPage(state),
        signal,
      ),
    );
  };

export const resetSimulationDataAndHistory =
  (
    project: LinkableProject,
    previousAnalysis: string | null | undefined,
  ): SimulatorThunk<Promise<void>> =>
  async (dispatch) => {
    dispatch(
      prepareForNewProject({
        project,
        previousAnalysis,
      }),
    );
    await dispatch(pauseAndNew(true));
  };

export const updateRunnerGlobals =
  (
    newGlobals: string,
    targetSimulationId?: string,
  ): SimulatorThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const state = getState();
    const [selectedRun] = getSimAndTarget(state);
    const simulationRunId = targetSimulationId ?? selectedRun;

    if (simulationRunId) {
      await runnerMessage(
        {
          type: "updateComponents",
          propertiesSrc: newGlobals,
        },
        simulationRunId,
      );
    }
  };

export const stepSimulator =
  (targetSimulationId?: string): SimulatorThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const state = getState();
    const simulationRunId =
      targetSimulationId ?? selectCurrentSimulationId(state);

    await runnerMessage(
      {
        type: "step",
        numSteps: 1,
        includeSteps: true,
      },
      simulationRunId,
    );
  };

export const toggleProviderTarget =
  (target?: ProviderTargetEnv): SimulatorThunk =>
  (dispatch) => {
    dispatch(pauseSimulator());
    const cur = simulationProvider.target;
    simulationProvider.target = target ?? (cur === "cloud" ? "web" : "cloud");
    dispatch(setProviderTarget(simulationProvider.target));

    if (selectScope[Scope.useCloud](appStore.getState())) {
      setLocalStorageSimulatorTarget(simulationProvider.target);
    }
  };

/**
 * @todo this should be done by a middleware, not a thunk
 */
export const removeSimulationRun =
  (simulationId: string): SimulatorThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const state = getState();
    const runs = selectAllSingleRuns(state);

    if (runs.length === 1 && runs[0].simulationRunId === simulationId) {
      await dispatch(pauseAndNew());
    }
    dispatch(removeSimulationData(simulationId));
  };

export const openExperiment =
  (experimentId: string | null): SimulatorThunk<Promise<void>> =>
  async (dispatch, getState) => {
    dispatch(setSelectedExperiment(experimentId));

    /**
     * @todo this side effect should be done by middleware / subscriber
     */
    if (experimentId) {
      const state = getState();
      const experiment: AnyExperimentRun =
        selectExperimentRuns(state)[experimentId] ??
        selectPendingExperimentRuns(state)[experimentId];
      const simulationData = selectAllSimulationData(state);

      if (!experiment) {
        throw new Error("Cannot open non-existent experiment");
      }

      if (experimentRunInitialized(experiment)) {
        const runs = experiment.simulationIds.map((id) => {
          const run = simulationData[id];

          if (!run) {
            throw new Error("Missing experiment simulation");
          }
          return run;
        });

        await Promise.all(
          runs.map(async (run) => {
            if (!run.plots && run.analysisLink) {
              const analysis =
                await historicCloudExperimentProvider.getAnalysis(
                  experiment,
                  run,
                );

              dispatch(
                setSimulationAnalysis({
                  simId: run.simulationRunId,
                  analysis,
                }),
              );
            }
          }),
        );
      }
    }
  };

export const downloadStepsForRun =
  (run: SimulationData): SimulatorThunk<Promise<void>> =>
  async (dispatch, getState) => {
    if (run.experimentId && !run.stepsCount && run.stepsLink) {
      const experiment = selectExperimentRuns(getState())[run.experimentId];

      if (experiment) {
        const timeout = setTimeout(() => {
          dispatch(
            setSimulationStatus({
              simId: run.simulationRunId,
              status: "downloading",
            }),
          );
        }, 100);

        try {
          const steps = await historicCloudExperimentProvider.getSteps(
            experiment,
            run,
          );

          clearTimeout(timeout);

          dispatch(
            setExperimentSteps({
              experimentId: experiment.experimentId,
              simulationId: run.simulationRunId,
              steps,
            }),
          );
        } catch (err) {
          clearTimeout(timeout);
          dispatch(
            setSimulationStatus({
              simId: run.simulationRunId,
              status: "errored",
            }),
          );
          console.error(err);
        }
      }
    }
  };

/**
 * @todo this should not be a thunk
 */
export const setViewerSpeed =
  (speed: number | "live"): SimulatorThunk =>
  (dispatch, getState) => {
    const state = getState();
    const canCompute = selectCanCurrentSimCompute(state);
    const canPresent = selectCanPresent(state);

    if (canCompute) {
      dispatch(resumeSimulator({ speed }));
    } else {
      if (typeof speed === "number") {
        if (canPresent) {
          dispatch(present({ speed }));
        } else {
          dispatch(setPresentingSpeed(speed));
        }
      } else {
        throw new Error("Cannot present at live speed");
      }
    }
  };

export const earlyStopSimulation =
  (simId: string, message: unknown): SimulatorThunk =>
  (dispatch, getState) => {
    const sim = selectAllSimulationData(getState())[simId];

    if (sim && !simulationComplete(sim)) {
      const parsedMessage = parseStopMessage(message);
      appStore.dispatch(
        addUserAlert({
          type: parsedMessage.status,
          message: parsedMessage.reason,
          context: "",
          timestamp: Date.now(),
          simulationId: simId,
        }),
      );
    }
  };
