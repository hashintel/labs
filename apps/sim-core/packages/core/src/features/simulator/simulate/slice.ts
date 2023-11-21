import {
  AnyAction,
  createAction,
  createSlice,
  Draft,
  EntityId,
  freeze,
  PayloadAction,
} from "@reduxjs/toolkit";
import {
  ExperimentPlan,
  ExperimentPlanEntry,
  ExperimentRun,
  ProviderTargetEnv,
  RunnerStatus,
  SimulationStates,
} from "@hashintel/engine-web";

import { AnalysisMode } from "./enum";
import { Commit, ProjectHistoryItemType } from "../../../util/api/auto-types";
import { CommitWithoutStats } from "../../../util/api/queries/commitActions";
import {
  DEFAULT_STEPS_PER_SECOND,
  defaultSimulationData,
  hasExperimentFailed,
  hasExperimentFinished,
  historyInitialState,
  initialSimulatorState,
  minimumAvailableStep,
  parseStopMessage,
  simulationComplete,
  simulationHasSteps,
  simulationStepCount,
} from "./util";
import { LinkableProject, ReleaseDescription } from "../../project/types";
import { OutputPlots } from "../../../components/PlotViewer/analyze";
import type {
  PendingExperimentRun,
  SimulationData,
  SimulatorSlice,
} from "./types";
import {
  ProjectHistoryItemCommitGroup,
  ProjectHistoryItemExperimentRun,
  ProjectHistoryItemRelease,
  ProjectHistoryReturnWithCustomItem,
} from "../../../util/api/queries/projectHistory";
import {
  RECENTS_COMMIT_GROUP_ID,
  getHistoryItemId,
  historyAdapter,
} from "./historyAdapter";
import {
  SimulationAnalysis,
  SimulatorHistoryItemCommitGroup,
  SimulatorHistoryItemExperimentRun,
  SimulatorHistoryItemRelease,
  SimulatorHistoryItemType,
} from "./types";
import { SimulatorRootState } from "../types";
import { TabKind } from "../../viewer/enums";
import { store as appStore } from "../../store";
import { isCompleteErrorMessage } from "../../utils";
import {
  selectCurrentStep,
  selectRunning,
  selectTrackingFinalStep,
} from "./selectors";
import { selectCurrentTab } from "../../viewer";
import { selectSimulationRequiresPyodide } from "../../files/selectors";

/**
 * @todo this file needs a clean up ensuring properties are properly reset
 */

/**
 * These setters must be completely immutable
 */
const immutableSetters = {
  /**
   * This ensures that any properties that point to a simulation run are cleaned
   * up after removing a simulation. It does not actually remove the simulation
   *
   * @deprecated we should use immer for this instead
   * @todo remove this
   */
  cleanupAfterRemovingSimulation(
    state: SimulatorSlice,
    id: string
  ): SimulatorSlice {
    const currentSimulation =
      id === state.currentSimulation ? null : state.currentSimulation;

    return {
      ...state,
      currentSimulation,
      analysisMode: currentSimulation === null ? null : state.analysisMode,
    };
  },
};

const getCurrentSimFromState = (
  state: Draft<SimulatorSlice>,
  errorMessage: string
) => {
  if (
    !state.currentSimulation ||
    !state.simulationData[state.currentSimulation]
  ) {
    throw new Error(errorMessage);
  }

  return state.simulationData[state.currentSimulation];
};

const sortSimulationIds = (
  state: SimulatorSlice | Draft<SimulatorSlice>,
  experiment: ExperimentRun
) =>
  [...experiment.simulationIds].sort((a, b) => {
    const firstRun = state.simulationData[a];
    const secondRun = state.simulationData[b];

    const firstOutcome = firstRun?.metricOutcome;
    const secondOutcome = secondRun?.metricOutcome;

    if (typeof firstOutcome !== "number" && typeof secondOutcome !== "number") {
      return 0;
    }

    if (typeof firstOutcome !== "number") {
      return 1;
    }

    if (typeof secondOutcome !== "number") {
      return -1;
    }

    return (
      (firstOutcome - secondOutcome) *
      (experiment.metricObjective === "max" ? -1 : 1)
    );
  });

const setters = {
  setPresentingSim(
    state: Draft<SimulatorSlice>,
    sim: Draft<SimulationData>,
    presenting: boolean
  ) {
    sim.presenting = presenting;
  },

  startPresentingSim(state: Draft<SimulatorSlice>, sim: Draft<SimulationData>) {
    setters.setPresentingSim(state, sim, true);

    if (sim.scrubbedStep !== null && sim.scrubbedStep >= sim.stepsCount - 1) {
      if (sim.mode === "computeAndPlayback") {
        setters.setSimLive(state, sim);
      } else {
        // @todo use a scrubbed step setter
        sim.scrubbedStep = sim.stepsCount - 1;
      }
    }
  },

  startPresentingCurrentSim(state: Draft<SimulatorSlice>) {
    setters.startPresentingSim(
      state,
      getCurrentSimFromState(
        state,
        "Cannot start presenting a non existent sim"
      )
    );
  },

  stopPresentingSim(state: Draft<SimulatorSlice>, sim: Draft<SimulationData>) {
    setters.setPresentingSim(state, sim, false);

    /**
     * @todo this should not be possible
     * @todo use scrubbed step setter
     */
    if (sim.scrubbedStep === null && sim.presentingSpeed !== "live") {
      sim.scrubbedStep = sim.stepsCount;
    }
  },

  stopPresentingCurrentSim(state: Draft<SimulatorSlice>) {
    setters.stopPresentingSim(
      state,
      getCurrentSimFromState(state, "Cannot stop presenting a non existent sim")
    );
  },

  // @todo clean up
  setScrubbedStepSim(
    state: Draft<SimulatorSlice>,
    sim: Draft<SimulationData>,
    step: number | null,
    pause = true
  ) {
    const maxStepIndex = sim.stepsCount - 1;

    if (step === null) {
      setters.setSimLive(state, sim);
    } else {
      const max = Math.min(maxStepIndex, step);
      const min = minimumAvailableStep(sim);
      sim.scrubbedStep = Math.max(min, max);

      const canCompute = sim.mode === "computeAndPlayback";

      if (pause || (!canCompute && step >= maxStepIndex)) {
        sim.owedSteps = 0;
        setters.stopPresentingSim(state, sim);
      } else if (canCompute) {
        sim.owedSteps += step - max;
      }

      if (sim.presentingSpeed === "live") {
        sim.presentingSpeed = DEFAULT_STEPS_PER_SECOND;
      }
    }
  },

  // @todo clean up
  setScrubbedStepCurrentSim(
    state: Draft<SimulatorSlice>,
    step: number | null,
    pause = true
  ) {
    setters.setScrubbedStepSim(
      state,
      getCurrentSimFromState(
        state,
        "Cannot set scrubbed step on non existent sim"
      ),
      step,
      pause
    );
  },

  setScrubbedStepWithTrackingCurrentSim(
    state: Draft<SimulatorSlice>,
    step: number | null,
    pause = true
  ) {
    const sim = getCurrentSimFromState(
      state,
      "Cannot stop presenting a non existent sim"
    );

    setters.setScrubbedStepSim(
      state,
      sim,
      step === null ||
        (step >= sim.stepsCount - 1 && sim.mode === "computeAndPlayback")
        ? null
        : step,
      pause
    );
  },

  setSimLive(state: Draft<SimulatorSlice>, sim: Draft<SimulationData>) {
    if (sim.mode === "historic") {
      throw new Error("Cannot set historic sim live");
    }

    sim.mode = "computeAndPlayback";
    sim.scrubbedStep = null;
    sim.presenting = sim.status === "running";
    sim.presentingSpeed = "live";
  },

  setSimulationMode(
    state: Draft<SimulatorSlice>,
    sim: Draft<SimulationData>,
    mode: SimulationData["mode"]
  ) {
    if (sim.mode === "historic") {
      throw new Error("Cannot set mode on a historic sim");
    }

    sim.mode = mode;

    const live = sim.presentingSpeed === "live" || sim.scrubbedStep === null;

    if (sim.presentingSpeed === 0) {
      sim.presentingSpeed = DEFAULT_STEPS_PER_SECOND;
    }

    if (mode === "computeAndPlayback") {
      if (
        sim.scrubbedStep !== null &&
        (live || sim.scrubbedStep >= sim.stepsCount - 1)
      ) {
        setters.setSimLive(state, sim);
      }
    } else {
      if (live) {
        sim.presentingSpeed = DEFAULT_STEPS_PER_SECOND;
        sim.scrubbedStep = sim.stepsCount;
      }

      if (sim.status === "running") {
        sim.status = "paused";
      }
    }

    setters.stopPresentingSim(state, sim);
  },

  setSimulationRunning(
    state: Draft<SimulatorSlice>,
    simId: string | undefined | null,
    running: boolean,
    speed?: number | "live"
  ) {
    if (!simId || !state.simulationData[simId]) {
      if (running) {
        throw new Error("Cannot set non-existent simulation running");
      } else {
        /**
         * Pausing with no simulation is a no-op
         */
        return;
      }
    }

    const sim = state.simulationData[simId];

    if (simulationComplete(sim as SimulationData)) {
      if (running) {
        throw new Error("Cannot set running a completed simulation");
      } else {
        /**
         * Pausing a completed simulation (i.e, when ensuring its paused when
         * resetting) should be a no-op
         */
        return;
      }
    }

    if (sim.mode === "historic") {
      if (running) {
        throw new Error("Cannot set running a historic simulation");
      } else {
        /**
         * Pausing a historic simulation (i.e, when ensuring its paused when
         * resetting) should be a no-op
         */
        return;
      }
    }

    if (running) {
      setters.startPresentingSim(state, sim);
      sim.status = "running";

      if (sim.mode !== "computeAndPlayback") {
        setters.setSimulationMode(state, sim, "computeAndPlayback");
      }
    } else {
      if (sim.mode === "computeAndPlayback") {
        setters.stopPresentingSim(state, sim);
      }

      sim.status = "paused";
    }

    if (speed === "live") {
      setters.setSimLive(state, sim);
    } else if (typeof speed === "number") {
      setters.startPresentingSim(state, sim);
      sim.presentingSpeed = speed;
    }

    /**
     * We need to turn off tracking for presenting to have an effect – this
     * updates the current step to the final step
     */
    if (
      sim.presentingSpeed !== "live" &&
      sim.scrubbedStep === null &&
      running
    ) {
      // @todo use a scrubbedStep setter
      sim.scrubbedStep = sim.stepsCount;
    }
  },
};

const { reducer, actions } = createSlice({
  name: "simulator",
  initialState: initialSimulatorState,
  reducers: {
    setProviderTarget(state, action: PayloadAction<ProviderTargetEnv>) {
      state.selectedTarget = action.payload;
    },

    // Used by initialize to create an empty simulation data
    resetViewer(state) {
      state.resetting = true;
      state.pyodideStatus = selectSimulationRequiresPyodide(appStore.getState())
        ? "loading"
        : "unused";
    },

    setScrubbedStep(state, action: PayloadAction<number | null>) {
      setters.setScrubbedStepWithTrackingCurrentSim(state, action.payload);
    },

    incrementStep(state, action: PayloadAction<number>) {
      const sim = getCurrentSimFromState(
        state,
        "Cannot increment a non existent sim"
      );

      // @todo this will increment back to the start if we're currently live + handle that
      const nextStep = (sim.scrubbedStep ?? 0) + action.payload;

      if (sim.status === "running") {
        setters.setScrubbedStepCurrentSim(state, nextStep, false);
      } else {
        setters.setScrubbedStepWithTrackingCurrentSim(state, nextStep, false);
      }
    },

    setPresentingSpeed(state, action: PayloadAction<number>) {
      const sim = getCurrentSimFromState(
        state,
        "Cannot set presenting speed a non existent sim"
      );

      sim.presentingSpeed = action.payload;
      sim.owedSteps = 0;
    },

    stopPresenting(state) {
      setters.stopPresentingCurrentSim(state);
    },

    present(state, action: PayloadAction<{ speed?: number } | undefined>) {
      setters.startPresentingCurrentSim(state);

      const fullState = { simulator: state } as SimulatorRootState;
      const running = selectRunning(fullState);
      const trackingFinalStep = selectTrackingFinalStep(fullState);

      if (running && trackingFinalStep) {
        setters.setScrubbedStepCurrentSim(state, selectCurrentStep(fullState));
      }

      if (action.payload?.speed !== undefined) {
        const sim = getCurrentSimFromState(
          state,
          "Cannot set presenting speed on non-existent sim"
        );
        sim.presentingSpeed = action.payload.speed;
      }
    },

    simulationRunFailed(
      state,
      action: PayloadAction<{ simulationId: string; errorMessage: string }>
    ) {
      const run = state.simulationData[action.payload.simulationId];
      if (run) {
        run.status = simulationErrorOrCompleteStatus(
          action.payload.errorMessage,
          run as SimulationData
        );
      }
    },

    setSelectedSimulation(
      state,
      action: PayloadAction<{
        simId: string;
        selected?: boolean;
        latest?: boolean;
      }>
    ) {
      if (action.payload.selected ?? true) {
        // @todo there should be a separate action for toggling a selected sim
        const simId =
          state.currentSimulation === action.payload.simId &&
          state.analysisMode === AnalysisMode.SingleRun
            ? null
            : action.payload.simId;

        state.currentSimulation = simId;
        state.analysisMode = simId ? AnalysisMode.SingleRun : null;
        state.history.selectedCommitGroup = null;

        if (simId) {
          const sim = state.simulationData[simId];

          if (sim) {
            state.selectedExperimentId = sim.experimentId ?? null;
            state.analysisMode = AnalysisMode.SingleRun;
            state.currentSimulation = simId;
          } else {
            throw new Error("Cannot find simulation to set as latest");
          }
        }
      }

      if (action.payload.latest) {
        for (const [id, sim] of Object.entries(state.simulationData)) {
          if (id === action.payload.simId) {
            /**
             * If the simulation has errored whilst its initialising, its
             * mode will already be historic as all completed sims have a
             * mode of historic
             */
            if (sim.mode !== "historic") {
              setters.setSimulationMode(state, sim, "computeAndPlayback");
              sim.presentingSpeed = "live";
            }
          } else if (!simulationHasSteps(sim) && !sim.experimentId) {
            delete state.simulationData[id];
            historyAdapter.removeOne(
              state.history,
              getHistoryItemId.singleRun(sim)
            );
          } else {
            setters.stopPresentingSim(state, sim);
            if (sim.mode !== "historic") {
              setters.setSimulationMode(state, sim, "historic");
            }
          }
        }
      }

      return state;
    },

    setSimulationRunning(
      state,
      action: PayloadAction<{
        running: boolean;
        simId?: string;
        speed?: number | "live";
      }>
    ) {
      setters.setSimulationRunning(
        state,
        action.payload.simId ?? state.currentSimulation,
        action.payload.running,
        action.payload.speed
      );
    },

    resumeSimulator(
      state,
      action: PayloadAction<{
        simId?: string;
        speed?: number | "live";
      }>
    ) {
      setters.setSimulationRunning(
        state,
        action.payload.simId ?? state.currentSimulation,
        true,
        action.payload.speed
      );
    },

    pauseSimulator(
      state,
      action: PayloadAction<
        | {
            simId?: string;
          }
        | undefined
      >
    ) {
      setters.setSimulationRunning(
        state,
        action.payload?.simId ?? state.currentSimulation,
        false
      );
    },

    toggleCurrentSimulator(state) {
      if (
        !state.currentSimulation ||
        !state.simulationData[state.currentSimulation]
      ) {
        throw new Error("Cannot toggle non-existent simulation");
      }

      const running =
        state.simulationData[state.currentSimulation].status === "running";

      setters.setSimulationRunning(state, state.currentSimulation, !running);
    },

    toggleCurrentSimulationMode(state) {
      const sim = getCurrentSimFromState(
        state,
        "Cannot toggle mode on non existent sim"
      );

      if (sim.mode === "historic") {
        throw new Error("Cannot toggle mode of historic sim");
      }

      setters.setSimulationMode(
        state,
        sim,
        sim.mode === "playback" ? "computeAndPlayback" : "playback"
      );
    },

    setSimulationStepRetention(
      state,
      action: PayloadAction<SimulationData["stepRetention"]>
    ) {
      const sim = getCurrentSimFromState(
        state,
        "Cannot set step retention on non existent sim"
      );

      const { retentionPolicy } = action.payload;

      if (retentionPolicy === "some") {
        setters.setSimLive(state, sim);
      }

      sim.stepRetention = action.payload;
    },

    /**
     * @warning this should only be called by sync.ts
     */
    setCloudDisabled(state, action: PayloadAction<boolean>) {
      state.cloudDisabled = action.payload;
    },

    removeSimulationData(state, action: PayloadAction<string>) {
      const id = action.payload;
      if (state.simulationData.hasOwnProperty(id)) {
        const simulation = state.simulationData[id];
        delete state.simulationData[id];
        historyAdapter.removeOne(
          state.history,
          getHistoryItemId.singleRun(simulation)
        );

        const simActive = state.currentSimulation === id;

        if (simActive) {
          state.currentSimulation = null;
          state.analysisMode = null;
        }

        if (
          simulation.experimentId &&
          state.experimentRuns.hasOwnProperty(simulation.experimentId)
        ) {
          const experiment = state.experimentRuns[simulation.experimentId];
          const nextSimIds = experiment.simulationIds.filter(
            (simId) => simId !== id
          );

          const index = experiment.simulationIds.indexOf(id);
          const after = experiment.simulationIds
            .slice(index + 1)
            .filter((simId) => simId !== id);
          const before = experiment.simulationIds.slice(0, index);

          experiment.simulationIds = nextSimIds;

          if (simActive) {
            state.currentSimulation =
              after[0] ?? before[before.length - 1] ?? null;

            if (state.currentSimulation) {
              state.analysisMode = AnalysisMode.SingleRun;
            }
          }

          if (!nextSimIds.length) {
            delete state.experimentRuns[experiment.experimentId];
            historyAdapter.removeOne(
              state.history,
              getHistoryItemId.experiment(experiment)
            );

            if (state.selectedExperimentId === experiment.experimentId) {
              state.selectedExperimentId = null;
            }
          }
        }
      }
    },

    updateHistory(
      state,
      action: PayloadAction<{
        history: ProjectHistoryReturnWithCustomItem;
        project: LinkableProject;
      }>
    ) {
      const { history, project } = action.payload;

      const experiments = history.items.filter(
        (item): item is ProjectHistoryItemExperimentRun =>
          item.itemType === ProjectHistoryItemType.ExperimentRun
      );

      const releases = history.items.filter(
        (item): item is ProjectHistoryItemRelease =>
          item.itemType === ProjectHistoryItemType.Release
      );

      historyAdapter.addMany(
        state.history,
        releases.map(
          (release): SimulatorHistoryItemRelease => ({
            itemType: SimulatorHistoryItemType.Release,
            createdAt: new Date(release.createdAt).getTime(),
            item: { tag: release.item.tag },
            historyId: getHistoryItemId.release(release.item),
          })
        )
      );

      const commitGroups = history.items.filter(
        (item): item is ProjectHistoryItemCommitGroup =>
          item.itemType === ProjectHistoryItemType.CommitGroup
      );

      const historyItemsForCommits = commitGroups.map(
        (commitGroup): SimulatorHistoryItemCommitGroup => ({
          itemType: SimulatorHistoryItemType.CommitGroup,
          createdAt: new Date(commitGroup.createdAt).getTime(),
          item: { commits: commitGroup.item.commits },
          historyId: getHistoryItemId.commitGroup(commitGroup.item),
        })
      );
      historyAdapter.addMany(state.history, historyItemsForCommits);

      const groupForProjectRef = historyItemsForCommits.find((group) =>
        group.item.commits.some(
          (commit) => commit.id === action.payload.project.ref
        )
      );

      if (groupForProjectRef) {
        state.history.selectedCommitGroup = groupForProjectRef.historyId;
        state.currentSimulation = null;
        state.selectedExperimentId = null;
        state.analysisMode = null;
      }

      const filteredExperiments = experiments.filter(
        (item) => item.item.simulationRuns.length > 0
      );

      if (project) {
        historyAdapter.addMany(
          state.history,
          filteredExperiments.map(
            (item): SimulatorHistoryItemExperimentRun => ({
              ...item,
              historyId: getHistoryItemId.experiment(item.item),
              itemType: SimulatorHistoryItemType.ExperimentRun,
              item: {
                id: item.item.id,
              },
              createdAt: new Date(item.item.createdAt).getTime(),
            })
          )
        );

        const filteredRuns = filteredExperiments.map((item) => item.item);

        for (const run of filteredRuns) {
          const startedTime = new Date(run.createdAt).getTime();

          for (const simRun of run.simulationRuns) {
            /**
             * This relies on the API returning null for stepsLink when there
             * has been an error
             */
            const status = simRun.analysisLink
              ? simRun.stepsLink
                ? "completed"
                : "errored"
              : "running";
            state.simulationData[simRun.id] = {
              ...defaultSimulationData,
              startedTime,
              simulationRunId: simRun.id,
              stepsLink: simRun.stepsLink,
              analysisLink: status === "completed" ? simRun.analysisLink : null,
              status,
              experimentId: run.id,
              mode: "historic",
              presentingSpeed: 1,
              presenting: false,
              metricOutcome:
                status === "errored"
                  ? undefined
                  : simRun.metricOutcome ?? undefined,
              metricName: run.packageData?.metricName ?? undefined,
            };
          }

          const statuses = new Set(
            run.simulationRuns.map((run) => state.simulationData[run.id].status)
          );

          const experimentRun: ExperimentRun = {
            project: {
              path: project.pathWithNamespace,
              ref: project.ref!,
            },
            metricObjective: run.packageData?.metricObjective ?? undefined,
            target: "cloud",
            experimentName: run.name,
            experimentId: run.id,
            status: statuses.has("errored")
              ? "errored"
              : statuses.has("running")
              ? "running"
              : "completed",
            definition: run.experimentSrc[run.name],
            simulationIds: run.simulationRuns.map((run) => run.id),
            plan: Object.fromEntries(
              run.simulationRuns.map((sim): [string, ExperimentPlanEntry] => [
                sim.id,
                {
                  fields: sim.propertyValues,
                },
              ])
            ),
            startedTime,
          };

          experimentRun.simulationIds = sortSimulationIds(state, experimentRun);
          experimentRun.metricOutcome =
            experimentRun.simulationIds.length > 0
              ? state.simulationData[experimentRun.simulationIds[0]]
                  ?.metricOutcome ?? undefined
              : undefined;

          state.experimentRuns[run.id] = experimentRun;
        }
      }

      state.history.nextPage =
        history.remaining && history.next ? history.next : null;
      state.history.complete = !history.remaining;

      if (history.receivedCurrent) {
        state.history.receivedCurrent = true;
      }
    },

    setHistoryHasFilledScreen(state, action: PayloadAction<boolean>) {
      state.history.haveFilledScreen = action.payload;
    },

    setHistoryRequestingMore(state, action: PayloadAction<boolean>) {
      state.history.requestingMore = action.payload;
    },

    setHistoryVisible(state, action: PayloadAction<boolean>) {
      state.history.visible = action.payload;
    },

    refetchHistory(state) {
      const idsToRemove = state.history.ids.filter((id) => {
        const item = state.history.entities[id];

        return (
          item &&
          item.itemType !== SimulatorHistoryItemType.SingleRun &&
          (item.itemType !== SimulatorHistoryItemType.ExperimentRun ||
            state.experimentRuns[item.item.id]?.target === "cloud")
        );
      });

      historyAdapter.removeMany(state.history, idsToRemove);

      state.history = {
        ...historyInitialState,
        entities: state.history.entities,
        ids: state.history.ids,
        project: state.history.project,
        visible: state.history.visible,
        selectedCommitGroup: state.history.selectedCommitGroup,
      };
    },

    releaseCreated(state, action: PayloadAction<ReleaseDescription>) {
      historyAdapter.addOne(state.history, {
        itemType: SimulatorHistoryItemType.Release,
        createdAt: new Date(action.payload.createdAt).getTime(),
        item: { tag: action.payload.tag },
        historyId: getHistoryItemId.release(action.payload),
      });
    },

    commitCreated(
      state,
      action: PayloadAction<{ commit: CommitWithoutStats; createdAt: number }>
    ) {
      const commit = action.payload.commit as Commit;
      const commitGroup: SimulatorHistoryItemCommitGroup["item"] = {
        commits: [commit],
        recents: true,
      };
      const historyId = getHistoryItemId.commitGroup(commitGroup);
      const existingGroup = state.history.entities[historyId];

      if (existingGroup) {
        if (existingGroup.itemType !== SimulatorHistoryItemType.CommitGroup) {
          throw new Error(
            "Cannot add commit to existing recents group as it is not a commit group"
          );
        }

        existingGroup.item.commits.unshift(commit);
        /**
         * Using the history adapter for this to ensure that the sort order of
         * history items is updated to reflect this
         */
        historyAdapter.updateOne(state.history, {
          id: historyId,
          changes: { createdAt: action.payload.createdAt },
        });
      } else {
        historyAdapter.addOne(state.history, {
          historyId,
          createdAt: action.payload.createdAt,
          itemType: SimulatorHistoryItemType.CommitGroup,
          item: commitGroup,
        });
      }
    },

    toggleCommitGroup(state, action: PayloadAction<EntityId>) {
      if (state.history.selectedCommitGroup === action.payload) {
        state.history.selectedCommitGroup = null;
      } else {
        state.history.selectedCommitGroup = action.payload;
        state.currentSimulation = null;
        state.selectedExperimentId = null;
        state.analysisMode = null;
      }
    },

    experimentSimulationsCreated(
      state,
      action: PayloadAction<{ plan: ExperimentPlan; experimentId: string }>
    ) {
      const { experimentId, plan } = action.payload;

      const currentExperiment = state.experimentRuns[experimentId];

      if (!currentExperiment) {
        throw new Error("Experiment to add simulation to does not exist");
      }

      currentExperiment.plan = { ...currentExperiment.plan, ...plan };

      for (const runId of Object.keys(plan)) {
        currentExperiment.simulationIds.push(runId);
        state.simulationData[runId] = {
          ...defaultSimulationData,
          simulationRunId: runId,
          // @todo this seems wrong
          startedTime: Date.now(),
          experimentId,

          // @todo should have a function to generate these properties
          mode: "historic",
          presentingSpeed: DEFAULT_STEPS_PER_SECOND,
          presenting: false,
        };
      }
    },

    experimentStopping(state, action: PayloadAction<string>) {
      const experiment = state.experimentRuns[action.payload];

      if (!experiment) {
        throw new Error("Cannot stop experiment which does not exist");
      }

      if (!hasExperimentFinished(experiment.status)) {
        experiment.status = "stopping";
      }
    },

    updatePendingExperimentTime(
      state,
      action: PayloadAction<{ pendingId: string; time: number }>
    ) {
      const pendingExperiment =
        state.pendingExperimentRuns[action.payload.pendingId];

      if (!pendingExperiment) {
        throw new Error("Cannot find pending experiment to update");
      }

      const historyId = getHistoryItemId.experiment(pendingExperiment);

      pendingExperiment.startedTime = action.payload.time;

      // Using history adapter to ensure sort order is updated
      historyAdapter.updateOne(state.history, {
        id: historyId,
        changes: { createdAt: action.payload.time },
      });
    },
  },
});

export const {
  resetViewer,
  setScrubbedStep,
  stopPresenting,
  setPresentingSpeed,
  incrementStep,
  present,
  setProviderTarget,
  simulationRunFailed,
  setSelectedSimulation,
  setSimulationRunning,
  pauseSimulator,
  resumeSimulator,
  toggleCurrentSimulator,
  toggleCurrentSimulationMode,
  setSimulationStepRetention,
  setCloudDisabled,
  removeSimulationData,
  updateHistory,
  setHistoryHasFilledScreen,
  setHistoryRequestingMore,
  setHistoryVisible,
  refetchHistory,
  releaseCreated,
  commitCreated,
  toggleCommitGroup,
  experimentSimulationsCreated,
  experimentStopping,
  updatePendingExperimentTime,
} = actions;

export const experimentFinished = createAction<string>(
  "simulator/experimentFinished"
);

export const simulationRunStarted = createAction<string>(
  "simulator/simulationRunStarted"
);

export const simulationRunUpdated = createAction<RunnerStatus>(
  "simulator/simulationRunUpdated"
);

export const removeExperiment = createAction<string>(
  "simulator/removeExperiment"
);

export const setSelectedExperiment = createAction<string | null>(
  "simulator/setSelectedExperiment"
);

export const setSimulationStatus = createAction<{
  status: SimulationData["status"];
  simId: string;
}>("simulator/setSimulationStatus");

export const addPendingExperiment = createAction<PendingExperimentRun>(
  "simulator/addPendingExperiment"
);

export const experimentFailed = createAction<string>(
  "simulator/experimentFailed"
);

export const initializeExperiment = createAction<{
  experiment: ExperimentRun;
  pendingExperimentId: string;
}>("simulator/initializeExperiment");

export const showCollatedAnalysisForExperiment = createAction<string>(
  "simulator/showCollatedAnalysisForExperiment"
);

export const prepareForNewProject = createAction<{
  project: LinkableProject;
  previousAnalysis?: string | null;
}>("simulator/prepareForNewProject");

export const setExperimentSteps = createAction<{
  experimentId: string;
  simulationId: string;
  steps: SimulationStates;
}>("simulator/setExperimentSteps");

export const updatePlotData = createAction<{
  simId: string;
  plots: OutputPlots | null;
}>("simulator/updatePlotData");

/**
 * @warning this will not clear plot data for cloud runs
 */
export const clearLocalPlotData = createAction("simulator/clearLocalPlotData");

export const setSimulationAnalysis = createAction<{
  simId: string;
  analysis: SimulationAnalysis | null;
}>("simulator/setSimulationAnalysis");

export const setAnalysisVisible = createAction<boolean>(
  "simulator/setAnalysisVisible"
);

const simulationErrorOrCompleteStatus = (
  errorMessage: string,
  run: SimulationData | null | undefined
) =>
  // TODO: Don't know why errorMessage ends up being undefined in some cases.
  typeof errorMessage === "string" &&
  isCompleteErrorMessage(errorMessage) &&
  simulationHasSteps(run)
    ? "completed"
    : "errored";

const simulationStatus = (
  simData: SimulationData | null | undefined,
  runner: RunnerStatus
): SimulationData["status"] => {
  const existingStatus = simData?.status;

  if (existingStatus === "errored" || existingStatus === "completed") {
    return existingStatus;
  }

  if (runner.runnerError) {
    return simulationErrorOrCompleteStatus(runner.runnerError.message, simData);
  }

  if (runner.earlyStop && existingStatus === "running") {
    const msg = parseStopMessage(runner.stopMessage);

    return msg.status === "error" ? "errored" : "completed";
  }

  if (
    simData?.experimentId &&
    (simData?.stepsCount > 0 || simData.analysis || simData.stepsLink)
  ) {
    return "completed";
  }
  // These are set separately to this and must not be overwritten
  if (
    existingStatus === "downloading" ||
    existingStatus === "running" ||
    existingStatus === "paused"
  ) {
    return existingStatus;
  }

  if (existingStatus !== "queued") {
    return "paused";
  }

  return "queued";
};

/**
 * Wrapping the slice to handle perf-critical updates manually to avoid Immer
 * which is used by createSlice and can slow down our updates too much. Any
 * of the actions handled manually must contain immutable only updates.
 */
export const simulationReducer: typeof reducer = (
  state: SimulatorSlice = initialSimulatorState,
  action: AnyAction
): SimulatorSlice => {
  if (experimentFinished.match(action)) {
    const experiment = state.experimentRuns[action.payload];

    if (!experiment) {
      console.error("Could not find experiment", action.payload);
      throw new Error("missing experiment");
    }

    if (!hasExperimentFinished(experiment.status)) {
      const simIds = sortSimulationIds(state, experiment);

      return {
        ...state,
        experimentRuns: {
          ...state.experimentRuns,
          [action.payload]: {
            ...experiment,
            metricOutcome: simIds.length
              ? state.simulationData[simIds[0]].metricOutcome
              : experiment.metricOutcome,
            simulationIds: simIds,
            status: hasExperimentFailed(state, experiment)
              ? "errored"
              : "completed",
          },
        },
      };
    }

    return state;
  } else if (simulationRunStarted.match(action)) {
    const simData = state.simulationData[action.payload];

    if (simData) {
      const { experimentId } = simData;
      const experiment = experimentId
        ? state.experimentRuns[experimentId]
        : null;

      return {
        ...state,

        // Updating experiment status
        experimentRuns:
          experiment && experiment.status !== "running"
            ? {
                ...state.experimentRuns,
                [experiment.experimentId]: {
                  ...state.experimentRuns[experiment.experimentId],
                  status: "running",
                },
              }
            : state.experimentRuns,

        // Update run status
        simulationData: {
          ...state.simulationData,
          [action.payload]: {
            ...simData,
            status: simData.status === "queued" ? "running" : simData.status,
          },
        },
      };
    }
  } else if (simulationRunUpdated.match(action)) {
    // Intentionally removing accumulatedSteps from the status
    const {
      accumulatedSteps,
      simulationRunId,
      pyodideStatus,
      stepsLink,
      ...status
    } = action.payload;

    if (simulationRunId) {
      /**
       * Due to the lag between requesting a pause and it happening, we can
       * sometimes receive extra steps even after we've deleted a run from our
       * activity history. This ensures those extra steps are ignored
       */
      const existingSim = state.simulationData[simulationRunId];

      if (action.payload.stepsTaken === 0 || existingSim) {
        const startedTime = existingSim?.startedTime;
        const existingSimData = existingSim ?? defaultSimulationData;

        const updatedSimData = {
          ...existingSimData,
          simulationRunId,
          /**
           * startedTime defaults to 0 so using || to ensure we set it
           * if its 0
           */
          startedTime: startedTime || Date.now(),
        };

        const stepRetention = existingSimData.stepRetention;
        const { stepsToRetain } = stepRetention;

        // add any steps sent from the engine to the simulation
        if (accumulatedSteps) {
          const stepsCount =
            updatedSimData.stepsCount + simulationStepCount(accumulatedSteps);
          updatedSimData.stepsCount = stepsCount;

          if (stepRetention.retentionPolicy === "some") {
            // handle the 'only retain last x steps' option
            const retainedSteps: SimulationData["steps"] = {};

            let retainFromStep = stepsCount - stepsToRetain;
            // Check if analysis is focused and there are plots to generate
            //    - we need to keep data that hasn't yet been analysed,
            //    which might disappear too quickly at a low retention rate.
            const focusedTab = selectCurrentTab(appStore.getState());
            const simHasPlots = !!Object.keys(updatedSimData.plots ?? {})
              .length;
            if (focusedTab === TabKind.Analysis && simHasPlots) {
              retainFromStep = Math.min(
                Object.keys(updatedSimData.plots?.rawOutputs ?? {}).length,
                retainFromStep
              );
            }

            for (
              let step = Math.max(retainFromStep, 0);
              step < stepsCount;
              step++
            ) {
              retainedSteps[step] =
                accumulatedSteps[step] ?? updatedSimData.steps[step];
            }
            updatedSimData.steps = freeze(retainedSteps);
          } else {
            updatedSimData.steps = freeze(
              updatedSimData?.steps
                ? {
                    ...updatedSimData.steps,
                    ...accumulatedSteps,
                  }
                : accumulatedSteps!
            );
          }
        }

        if (stepsLink?.agentSteps) {
          updatedSimData.stepsLink = stepsLink.agentSteps;
        }

        const nextStatus = simulationStatus(updatedSimData, action.payload);

        if (accumulatedSteps && Object.keys(accumulatedSteps).length) {
          if (updatedSimData.scrubbedStep !== null) {
            // ensure the scrubbed step doesn't fall behind retained data
            const stepDataAvailableFrom = minimumAvailableStep(updatedSimData);

            if (updatedSimData.owedSteps > 0) {
              // add any 'owed steps': steps that should've been incremented
              //    last tick given the playback speed, but weren't available
              const stepAfterDebtPaid = Math.min(
                updatedSimData.stepsCount,
                updatedSimData.scrubbedStep + updatedSimData.owedSteps
              );
              updatedSimData.scrubbedStep = Math.max(
                stepAfterDebtPaid,
                stepDataAvailableFrom
              );
              updatedSimData.owedSteps = 0;
            } else if (stepRetention.retentionPolicy === "some") {
              updatedSimData.scrubbedStep = Math.max(
                updatedSimData.scrubbedStep,
                stepDataAvailableFrom
              );
            }
          } else {
            updatedSimData.owedSteps = 0;
          }
        }

        /**
         * We have to apply the new steps to the data before calculating
         * the status because simulationStatus uses existence of steps
         * in its logic
         *
         * @todo we should use the setSimulationRunning setter here
         */
        updatedSimData.status = nextStatus;

        if (simulationComplete(updatedSimData)) {
          updatedSimData.mode = "historic";
        }

        let updatedHistory = state.history;

        if (!existingSim) {
          updatedHistory = historyAdapter.addOne(updatedHistory, {
            historyId: getHistoryItemId.singleRun(updatedSimData),
            createdAt: updatedSimData.startedTime,
            itemType: SimulatorHistoryItemType.SingleRun,
            item: {
              id: updatedSimData.simulationRunId,
            },
          });
        }

        let updatedExperiments = state.experimentRuns;

        const nextSimulations = {
          ...state.simulationData,
          [simulationRunId]: updatedSimData,
        };

        if ("metricOutcome" in status && status.metricOutcome !== null) {
          const experiment = updatedSimData.experimentId
            ? { ...updatedExperiments[updatedSimData.experimentId] }
            : null;

          if (!updatedSimData.experimentId || !experiment) {
            throw new Error(
              "Cannot find experiment to apply optimization result to"
            );
          }

          updatedExperiments = {
            ...updatedExperiments,
            [updatedSimData.experimentId]: experiment,
          };

          updatedSimData.metricOutcome = status.metricOutcome;
          updatedSimData.metricName = status.metricName;
          experiment.metricObjective = status.metricObjective;
        }

        return {
          ...state,
          resetting: false,
          pyodideStatus: pyodideStatus,
          history: updatedHistory,
          experimentRuns: updatedExperiments,
          simulationData: nextSimulations,
        };
      }

      return state;
    } else {
      return {
        ...state,
        resetting: action.payload.resetting,
        pyodideStatus: action.payload.pyodideStatus,
      };
    }
  } else if (removeExperiment.match(action)) {
    const experiment: ExperimentRun | PendingExperimentRun | undefined =
      state.experimentRuns[action.payload] ??
      state.pendingExperimentRuns[action.payload];

    if (experiment) {
      let result = state;
      const replacementData = { ...state.simulationData };
      const replacementExperimentRuns = { ...state.experimentRuns };
      const replacementPendingExperimentRuns = {
        ...state.pendingExperimentRuns,
      };

      if ("simulationIds" in experiment) {
        for (const id of experiment.simulationIds) {
          result = immutableSetters.cleanupAfterRemovingSimulation(state, id);
          delete replacementData[id];
        }
      }

      delete replacementExperimentRuns[action.payload];
      delete replacementPendingExperimentRuns[action.payload];
      return {
        ...result,
        simulationData: replacementData,
        experimentRuns: replacementExperimentRuns,
        pendingExperimentRuns: replacementPendingExperimentRuns,

        /**
         * We don't need to delete single runs here because simulation runs of
         * experiment groups are not represented in history
         */
        history: historyAdapter.removeOne(
          state.history,
          getHistoryItemId.experiment(experiment)
        ),
      };
    }
    return state;
  } else if (setSelectedExperiment.match(action)) {
    if (state.selectedExperimentId !== action.payload) {
      const nextState = { ...state };
      nextState.currentSimulation = null;
      nextState.analysisMode = null;
      nextState.history = { ...state.history, selectedCommitGroup: null };
      nextState.selectedExperimentId = action.payload;
      return nextState;
    }
    return state;
  } else if (setSimulationStatus.match(action)) {
    const simData = state.simulationData[action.payload.simId];

    if (!simData) {
      throw new Error("Cannot find simulation to set status on");
    }

    return {
      ...state,
      currentSimulation:
        state.currentSimulation === action.payload.simId &&
        action.payload.status === "errored"
          ? null
          : state.currentSimulation,
      simulationData: {
        ...state.simulationData,
        [action.payload.simId]: {
          ...simData,
          status: action.payload.status,
        },
      },
    };
  } else if (addPendingExperiment.match(action)) {
    /**
     * "Opening" this experiment is delayed by 100ms in case we don't pend for
     * more than 100ms to avoid a flash of the pending state for an experiment
     */
    return {
      ...state,
      pendingExperimentRuns: {
        ...state.pendingExperimentRuns,
        [action.payload.experimentId]: action.payload,
      },
      history: historyAdapter.addOne(state.history, {
        historyId: getHistoryItemId.experiment(action.payload),
        itemType: SimulatorHistoryItemType.ExperimentRun,
        createdAt: action.payload.startedTime,
        item: { id: action.payload.experimentId },
      }),
    };
  } else if (initializeExperiment.match(action)) {
    const { experiment, pendingExperimentId } = action.payload;
    const { experimentId } = experiment;

    const pendingExperimentRuns = { ...state.pendingExperimentRuns };
    const pendingExperiment = pendingExperimentRuns[pendingExperimentId];

    delete pendingExperimentRuns[pendingExperimentId];

    const nextExperiment = {
      ...experiment,
      plan: {},
      simulationIds: [],
      // @todo look into if this is correct
      startedTime: pendingExperiment.startedTime,
    };

    let newHistory = historyAdapter.removeOne(
      state.history,
      getHistoryItemId.experiment(pendingExperiment)
    );

    newHistory = historyAdapter.addOne(newHistory, {
      historyId: getHistoryItemId.experiment(nextExperiment),
      itemType: SimulatorHistoryItemType.ExperimentRun,
      createdAt: nextExperiment.startedTime,
      item: { id: nextExperiment.experimentId },
    });

    return {
      ...state,
      pendingExperimentRuns,
      selectedExperimentId:
        state.selectedExperimentId === pendingExperimentId
          ? experimentId
          : state.selectedExperimentId,
      simulationData: state.simulationData,
      experimentRuns: {
        ...state.experimentRuns,
        [experimentId]: nextExperiment,
      },
      history: newHistory,
    };
  } else if (experimentFailed.match(action)) {
    const experimentId = action.payload;
    const pendingExperiment = state.pendingExperimentRuns[experimentId];
    const existingExperiment = state.experimentRuns[experimentId];

    if (pendingExperiment) {
      return {
        ...state,
        selectedExperimentId:
          state.selectedExperimentId === experimentId
            ? null
            : state.selectedExperimentId,
        pendingExperimentRuns: {
          ...state.pendingExperimentRuns,
          [experimentId]: {
            ...pendingExperiment,
            status: "errored",
          },
        },
      };
    } else if (existingExperiment) {
      const simIds = sortSimulationIds(state, existingExperiment);

      return {
        ...state,
        experimentRuns: {
          ...state.experimentRuns,
          [experimentId]: {
            ...existingExperiment,
            status: "errored",
            metricOutcome: simIds.length
              ? state.simulationData[simIds[0]].metricOutcome
              : existingExperiment.metricOutcome,
            simulationIds: simIds,
          },
        },
      };
    }

    throw new Error("Cannot find experiment to fail");
  } else if (showCollatedAnalysisForExperiment.match(action)) {
    if (!state.experimentRuns[action.payload]) {
      throw new Error(
        "Cannot show collated plots for experiment which does not exist"
      );
    }

    if (
      state.analysisMode === AnalysisMode.ExperimentCollated &&
      state.selectedExperimentId === action.payload
    ) {
      return {
        ...state,
        analysisMode: null,
      };
    }

    return {
      ...state,
      analysisMode: AnalysisMode.ExperimentCollated,
      currentSimulation: null,
      selectedExperimentId: action.payload,
      history: {
        ...state.history,
        selectedCommitGroup: null,
      },
    };
  } else if (setExperimentSteps.match(action)) {
    const simData = state.simulationData[action.payload.simulationId];

    const experiment = state.experimentRuns[action.payload.experimentId];
    if (!experiment || !simData) {
      throw new Error(
        "Cannot receive steps for experiment that does not exist"
      );
    }

    let newState: SimulatorSlice = {
      ...state,
      simulationData: {
        ...state.simulationData,
        [action.payload.simulationId]: {
          ...simData,
          steps: freeze(action.payload.steps),
          stepsCount: simulationStepCount(action.payload.steps),
          /**
           * @todo once we start receiving steps for even failed runs, we'll
           *       need to be able to determine if this is completed or errored
           */
          status: "completed",
        },
      },
    };

    if (
      !experiment.simulationIds.some(
        (id) => !newState.simulationData[id].stepsCount
      )
    ) {
      newState = {
        ...newState,
        experimentRuns: {
          ...state.experimentRuns,
          [experiment.experimentId]: {
            ...experiment,
            status: "completed",
          },
        },
      };
    }

    return newState;
  } else if (prepareForNewProject.match(action)) {
    const nextProject = action.payload.project;
    const switchingRef =
      state.history.project?.pathWithNamespace ===
      nextProject.pathWithNamespace;

    /**
     * A lot of this logic can be done earlier – i.e, when the next project becomes pending rather than when we receive it
     *
     * @todo make this faster
     */
    if (switchingRef) {
      const newSimulationRuns = { ...state.simulationData };

      for (const [runId, run] of Object.entries(newSimulationRuns)) {
        newSimulationRuns[runId] = {
          ...run,
          mode: "historic",
          status: simulationComplete(run) ? run.status : "completed",
          analysis:
            !action.payload.previousAnalysis || !!run.analysis
              ? run.analysis
              : { manifest: action.payload.previousAnalysis },
        };
      }

      let history = {
        ...state.history,
        project: nextProject,
      };

      if (
        history.ids.includes(RECENTS_COMMIT_GROUP_ID) &&
        history.entities[RECENTS_COMMIT_GROUP_ID]
      ) {
        // @todo clean up
        const recents: SimulatorHistoryItemCommitGroup = history.entities[
          RECENTS_COMMIT_GROUP_ID
        ]! as any;

        const newCommitGroup: SimulatorHistoryItemCommitGroup["item"] = {
          ...recents.item,
          recents: false,
        };

        const newHistoryId = getHistoryItemId.commitGroup(newCommitGroup);

        history = historyAdapter.addOne(history, {
          ...recents,
          historyId: newHistoryId,
          item: newCommitGroup,
        });

        history = historyAdapter.removeOne(history, RECENTS_COMMIT_GROUP_ID);

        if (history.selectedCommitGroup === RECENTS_COMMIT_GROUP_ID) {
          history = { ...history, selectedCommitGroup: newHistoryId };
        }
      }

      /**
       * @todo this is probably duplicated with `updateHistory`.
       */
      const selectedItemId = history.ids.find((id) => {
        const item = history.entities[id];

        switch (item?.itemType) {
          case SimulatorHistoryItemType.Release:
            return item.item.tag === nextProject.ref;

          case SimulatorHistoryItemType.CommitGroup:
            return item.item.commits.some(
              (commit) => commit.id === nextProject.ref
            );
        }

        return false;
      });

      const selectedItem = selectedItemId
        ? history.entities[selectedItemId]
        : null;

      if (selectedItem) {
        // @todo remove this check when changing selectedCommitGroup to selectedItem
        if (selectedItem.itemType === SimulatorHistoryItemType.CommitGroup) {
          history = { ...history, selectedCommitGroup: selectedItem.historyId };
        }
      }

      return {
        ...state,
        simulationData: newSimulationRuns,
        history,
      };
    }

    // @todo look into using initial state
    return {
      ...state,
      simulationData: {},
      experimentRuns: {},
      currentSimulation: null,
      selectedExperimentId: null,
      analysisMode: null,
      history: {
        ...historyInitialState,
        project: nextProject,
        visible: state.history.visible,
      },
    };
  } else if (updatePlotData.match(action)) {
    const { simId, plots } = action.payload;

    if (!state.simulationData[simId]) {
      throw new Error("Cannot update plots for non existent simulation");
    }

    if (state.simulationData[simId].plots !== plots) {
      return {
        ...state,
        simulationData: {
          ...state.simulationData,
          [simId]: {
            ...state.simulationData[simId],
            plots,
          },
        },
      };
    }
  } else if (setAnalysisVisible.match(action)) {
    return {
      ...state,
      analysisVisible: action.payload,
    };
  } else if (clearLocalPlotData.match(action)) {
    const newSimData: Record<string, SimulationData> = {};

    for (const [id, data] of Object.entries(state.simulationData)) {
      if (data.plots) {
        newSimData[id] = {
          ...data,
          plots: data.analysis ? data.plots : null,
        };
      }
    }

    if (Object.keys(newSimData).length) {
      return {
        ...state,
        simulationData: {
          ...state.simulationData,
          ...newSimData,
        },
      };
    } else {
      return state;
    }
  } else if (setSimulationAnalysis.match(action)) {
    const simData = state.simulationData[action.payload.simId];

    if (!simData) {
      throw new Error("Cannot find simulation to update");
    }

    return {
      ...state,
      simulationData: {
        ...state.simulationData,
        [action.payload.simId]: {
          ...simData,
          analysis: action.payload.analysis,
          status: "completed",
        },
      },
    };
  }

  return reducer(state, action);
};
