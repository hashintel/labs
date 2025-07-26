import { EntityId, EntityState } from "@reduxjs/toolkit";
import {
  ExperimentRun,
  OutputSeries,
  ProviderTargetEnv,
  RunnerStatus,
  SimulationRunId,
  SimulationStates,
} from "@hashintel/engine-web";

import { AnalysisMode } from "./enum";
import { CommitWithoutStats } from "../../../util/api/queries/commitActions";
import { LinkableProject } from "../../project/types";
import { OutputPlots } from "../../../components/PlotViewer/analyze";

export enum SimulatorHistoryItemType {
  Release = "Release",
  CommitGroup = "CommitGroup",
  ExperimentRun = "ExperimentRun",
  SingleRun = "SingleRun",
}

interface SimulatorHistoryItemShared {
  createdAt: number;
  historyId: string;
}

export type SimulatorHistoryItemExperimentRun = SimulatorHistoryItemShared & {
  itemType: SimulatorHistoryItemType.ExperimentRun;
  item: { id: string };
};
export type SimulatorHistoryItemSingleRun = SimulatorHistoryItemShared & {
  itemType: SimulatorHistoryItemType.SingleRun;
  item: { id: string };
};
export type SimulatorHistoryItemRelease = SimulatorHistoryItemShared & {
  itemType: SimulatorHistoryItemType.Release;
  item: { tag: string };
};
export type SimulatorHistoryItemCommitGroup = SimulatorHistoryItemShared & {
  itemType: SimulatorHistoryItemType.CommitGroup;
  item: { commits: CommitWithoutStats[]; recents?: boolean };
};

export type SimulatorHistoryItem =
  | SimulatorHistoryItemExperimentRun
  | SimulatorHistoryItemSingleRun
  | SimulatorHistoryItemRelease
  | SimulatorHistoryItemCommitGroup;

export interface SimulatorHistory extends EntityState<SimulatorHistoryItem> {
  nextPage: string | null;
  complete: boolean;
  receivedCurrent: boolean;
  haveFilledScreen: boolean;
  requestingMore: boolean;
  project: LinkableProject | null;

  /**
   * This does not actually control the rendering of activity history but
   * reflects whether the component is visible or not, so that we can know
   * whether to rely on it to inform us about whether it needs more information
   * or not
   */
  visible: boolean;

  /**
   * @todo make this selectItem and move currentSimulation/selectedExperimentId into this
   */
  selectedCommitGroup: EntityId | null;
}

export interface SimulatorSlice {
  // Which simulation are we focusing on to display?
  // This simulation will be the focus of the viewers
  currentSimulation: SimulationRunId | null;
  selectedExperimentId: string | null;

  // Should we grey-out the controls etc?
  resetting: boolean;
  pyodideStatus: RunnerStatus["pyodideStatus"];

  selectedTarget: ProviderTargetEnv;

  simulationData: Record<string, SimulationData>;

  experimentRuns: Record<string, ExperimentRun>;

  pendingExperimentRuns: Record<string, PendingExperimentRun>;

  analysisMode: AnalysisMode | null;

  /**
   * @note synced from main store
   */
  analysisVisible: boolean;
  cloudDisabled: boolean;

  history: SimulatorHistory;
}

export interface SimulationAnalysis {
  outputs?: OutputSeries;
  manifest: string;
}

export interface SimulationData {
  simulationRunId: string;
  steps: SimulationStates;
  /**
   * @todo this is necessary because steps is not an array so the browser
   *       doesn't track it for us
   * @todo its possible that the worker can tell us this
   */
  stepsCount: number;
  stepsLink?: string | null;
  analysisLink?: string | null;
  startedTime: number;
  plots: OutputPlots | null;
  analysis?: SimulationAnalysis | null;
  experimentId: string | null;
  metricOutcome?: RunnerStatus["metricOutcome"];
  metricName?: RunnerStatus["metricName"];

  /**
   * There is no compute only because it is computeAndPlayback
   * with speed of 0
   *
   * historic is a playback mode where you cannot switch on compute
   */
  mode: "playback" | "computeAndPlayback" | "historic";
  /**
   * Whether to limit step state retention to all or only some steps,
   *    and if only some, how many.
   */
  stepRetention: {
    retentionPolicy: "all" | "some";
    stepsToRetain: number;
  };
  scrubbedStep: number | null;
  owedSteps: number;
  presenting: boolean;
  presentingSpeed: number | "live";

  status:
    | "queued"
    | "running"
    | "completed"
    | "downloading"
    | "errored"
    | "paused";
}

export type PendingExperimentRun = Pick<
  ExperimentRun,
  | "experimentName"
  | "startedTime"
  | "target"
  | "experimentId"
  | "status"
  | "definition"
>;

export type AnyExperimentRun = ExperimentRun | PendingExperimentRun;
