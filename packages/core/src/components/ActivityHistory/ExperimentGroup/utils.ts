import { ExperimentRun } from "@hashintel/engine-web";

import { SimulationData } from "../../../features/simulator/simulate/types";

/**
 * This can represent both experiments and simulations – so we can only
 * represent common statuses
 */
export type ExperimentGroupSectionItemStatus =
  | (ExperimentRun["status"] & SimulationData["status"])
  | "downloading"
  | "completedWon";

/**
 * Used to collapse the various states an experiment or simulation could be
 * in into a set of common states – used for indicating status of
 * ExperimentGroupSectionItem
 *
 * @todo clean this up
 */
export const collapseExperimentOrSimulationRunStatus = (
  status: ExperimentRun["status"] | SimulationData["status"],
): ExperimentGroupSectionItemStatus =>
  status === "downloading"
    ? "downloading"
    : status === "queued"
      ? "queued"
      : status === "paused" || status === "stopping"
        ? "running"
        : status;
