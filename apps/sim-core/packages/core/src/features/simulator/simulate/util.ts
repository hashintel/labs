import { Draft, EntityState, freeze } from "@reduxjs/toolkit";
import lodash from "lodash";
import {
  ExperimentRun,
  FetchedDataset,
  ProviderTargetEnv,
  RawManifest,
  RunnerRequest,
  RunnerStatus,
  SimulationRunId,
  SimulationStates,
} from "@hashintel/engine-web";
import { parseDatasetUrl } from "@hashintel/utils/lib/datasets/fetchDataset";

import type { RootState as AppState } from "../../types";
import { DependenciesDescriptor, HcAnyDatasetFile } from "../../files/types";
import type { NamedBehaviorSrc } from "../../../util/types";
import { PendingExperimentRun, SimulatorHistory } from "./types";
import type { SimulationData, SimulatorSlice } from "./types";
import type { SimulatorRootState } from "../types";
// import { getLocalStorageSimulatorTarget } from "./target";
import { historyAdapter } from "./historyAdapter";
import {
  selectDatasetFiles,
  selectParsedDependencies,
  selectSharedBehaviorFiles,
  selectSimulationSrc,
} from "../../files/selectors";
import { simulationProvider } from "./buildprovider";

export const historyInitialState = historyAdapter.getInitialState<
  Omit<SimulatorHistory, keyof EntityState<SimulatorHistory>>
>({
  nextPage: null,
  complete: false,
  haveFilledScreen: false,
  requestingMore: false,
  project: null,
  visible: false,
  selectedCommitGroup: null,
  receivedCurrent: false,
});

export const initialSimulatorState: SimulatorSlice = {
  currentSimulation: null,
  simulationData: {},
  selectedTarget: "web",
  experimentRuns: {},
  pendingExperimentRuns: {},
  pyodideStatus: "unused",
  resetting: false,
  selectedExperimentId: null,
  analysisMode: null,
  analysisVisible: false,
  cloudDisabled: true,
  history: historyInitialState,
};

export const defaultSimulationData: SimulationData = {
  steps: freeze({}),
  stepsCount: 0,
  simulationRunId: "",
  startedTime: 0,
  plots: null,
  experimentId: null,
  status: "queued",
  mode: "computeAndPlayback",
  stepRetention: {
    retentionPolicy: "all",
    stepsToRetain: 1,
  },
  presentingSpeed: "live",
  presenting: true,
  scrubbedStep: null,
  owedSteps: 0,
};

/**
 * Send a message directly to the chosen experimenter
 * Default the to default runner if no runner is specified
 *
 * @warning this *will not* update the runner status between running/paused.
 * You need to dispatch setSimulationRunner and the runningSubscriber
 * will handle that.
 */
export const runnerMessage = async (
  req: RunnerRequest,
  simulationId: string
): Promise<RunnerStatus> => {
  return simulationProvider.handleRequest(req, simulationId);
};

const toFetchedDatasets = (
  files: HcAnyDatasetFile[],
  dependencies: DependenciesDescriptor
): FetchedDataset[] =>
  files.map<FetchedDataset>((file) => ({
    id: file.id,
    extension: file.path.ext.slice(1),
    filename: file.path.name,
    url: file.contents,
    shortname: correctedShortnameFromDependencies(
      file.path.formatted,
      file.repoPath,
      dependencies
    ),
    name: file.name,
    format: parseDatasetUrl(file.contents, file.data.rawCsv).format,
    s3Key: file.data.s3Key,
    inPlaceData: file.data.inPlaceData,
  }));

export const createCompleteManifest = (appState: AppState): RawManifest => {
  const simulationSrc = selectSimulationSrc(appState);
  const sharedBehaviors = selectSharedBehaviorFiles(appState);
  const dependencies = selectParsedDependencies(appState);
  const datasets = toFetchedDatasets(
    selectDatasetFiles(appState),
    dependencies
  );

  // @todo investigate removing this
  const behaviorsToAdd = sharedBehaviors.map<NamedBehaviorSrc>(
    ({ contents, id, path, repoPath }) => ({
      behaviorSrc: contents,
      id,
      dependencies: [],
      name: path.formatted,
      shortname: correctedShortnameFromDependencies(
        path.formatted,
        repoPath,
        dependencies
      ),
    })
  );
  console.log("added shared behaviors", behaviorsToAdd);

  // The API relies on shortname
  // The name might be "My number 1 behavior!"
  // But the shortname is "number1behavior.js"
  // We need to make sure we're only sending shortnames
  const userBehaviors = simulationSrc.behaviors.map((behavior) => ({
    ...behavior,
    shortname: behavior.shortname ?? behavior.name,
  }));
  // Inject them into the behavior list
  return {
    ...simulationSrc,
    datasets,
    behaviors: [...userBehaviors, ...behaviorsToAdd],
  };
};

export const getSimAndTarget = (
  state: SimulatorRootState
): [SimulationRunId | null, ProviderTargetEnv] => {
  const sim = state.simulator.currentSimulation;
  const target = state.simulator.selectedTarget;
  return [sim, target];
};

export const simulationComplete = (data: SimulationData | null | undefined) =>
  data?.status === "completed" ||
  data?.status === "errored" ||
  data?.status === "downloading";

export const hasExperimentFinished = (status: ExperimentRun["status"]) =>
  status === "completed" || status === "errored";

/**
 * @warning this has low performance – use the cached stepCount field
 * @todo remove this when SimulationStates is an array
 */
export const simulationStepCount = (steps?: SimulationStates | undefined) =>
  Object.keys(steps ?? {}).length;

/**
 * The lowest step index for which state data are available,
 *    based on the simulation's step data retention policy.
 */
export const minimumAvailableStep = ({
  stepRetention,
  stepsCount,
}: Pick<SimulationData, "stepRetention" | "stepsCount">) =>
  stepRetention.retentionPolicy === "some"
    ? Math.max(stepsCount - stepRetention.stepsToRetain, 0)
    : 0;

/**
 * Sometimes we consider having steps to mean having more than 0 steps, sometimes
 * more than 1 step, depending on whether experiment or not and other criteria
 *
 * @todo lets take that into account and use this in more places
 */
export const simulationHasSteps = (
  run: Pick<SimulationData, "stepsCount"> | null | undefined
) => (run ? run.stepsCount > 1 : false);

export const simulationViewable = (
  run: SimulationData | null | undefined,
  complete?: boolean
) =>
  (complete ?? simulationComplete(run)) &&
  (simulationHasSteps(run) ||
    (run?.status !== "errored" && (!!run?.analysis || !!run?.stepsLink)));

export const hasExperimentFailed = (
  state: SimulatorSlice | Draft<SimulatorSlice>,
  experiment: ExperimentRun
) => {
  if (experiment.status === "errored") {
    return true;
  }

  return experiment.simulationIds.some(
    (id) => state.simulationData[id]?.status === "errored"
  );
};

/**
 * @todo have a field on ExperimentRun or PendingExperimentRun that marks it as pending
 */
export const experimentRunInitialized = (
  run: ExperimentRun | PendingExperimentRun
): run is ExperimentRun => "plan" in run;

/**
 * The threshold after which a pending experiment is created that it won't be
 * shown in the UI – in milliseconds. This prevents "flash of pending ui" for
 * experiments that are created very quickly. This should be long enough that
 * it covers most quick experiments, but short enough that it doesn't feel
 * laggy to the user.
 */
export const EXPERIMENT_PENDING_THRESHOLD = 100;

export const DEFAULT_STEPS_PER_SECOND = 60;

type StopMessage = {
  status: "warning" | "error" | "complete";
  reason: string;
};

const hasProp = <K extends PropertyKey>(
  data: object,
  prop: K
): data is Record<K, unknown> => prop in data;

export const parseStopMessage = (msg: unknown): StopMessage => {
  let [status, reason] = ["", ""];
  if (
    typeof msg === "object" &&
    msg !== null &&
    hasProp(msg, "status") &&
    typeof msg.status === "string"
  ) {
    status = msg.status.toLowerCase();
    if (hasProp(msg, "reason") && typeof msg.reason === "string") {
      reason = msg.reason;
    }
  }
  switch (status) {
    case "error":
      return { status: "error", reason };
    case "warning":
      return { status: "warning", reason };
    case "success":
      return { status: "complete", reason };
    default:
      return { status: "warning", reason };
  }
};

const correctedShortnameFromDependencies = (
  shortname: string,
  repoPath: string,
  dependencies: DependenciesDescriptor
): string => {
  // We need to find the proper shortnames for our dependencies.
  // Our dependencies.json file has the expected values.
  // The paths of the values in /dependencies, however, vary.
  // E.g. some behaviors are expected at @{namespace}/{behavior.js} and others at {@namespace}/{behavior}/{behavior.js}
  // For a given dep, however, the namespace and final item name coupling will always be distinct.
  // Therefore to find our matching shortnames, we inspect the namespace and final name of a repo path,
  // then compare to our dependency list and use the best matching value.
  if (!repoPath.startsWith("dependencies/")) {
    // No Deps No Worries.
    return shortname;
  }

  const repoPathParts = repoPath.split("/");

  //Dependency repoPath always starts with "dependencies/@namespace/"
  const namespace = repoPathParts[1];
  // And ends with the file name ".../{name.ext}"
  const fileName = lodash.last(repoPathParts);

  //Now find an entry in dependencies that matches those conditions
  let correctedShortname = Object.keys(dependencies).find((dependency) => {
    const dependencyParts = dependency.split("/");
    return (
      dependencyParts[0] === namespace &&
      lodash.last(dependencyParts) === fileName
    );
  });

  if (!correctedShortname) {
    correctedShortname = [namespace, fileName].join("/");
    console.warn(
      "Unable to find corrected shortname for dependency. Using simple default instead.",
      repoPath,
      correctedShortname
    );
  }
  return correctedShortname;
};
