import { createEntityAdapter } from "@reduxjs/toolkit";
import { Draft } from "immer";

import { APIExperimentRun } from "../../../util/types";
import {
  AnyExperimentRun,
  SimulationData,
  SimulatorHistoryItem,
  SimulatorHistoryItemCommitGroup,
} from "./types";
import { ReleaseDescription } from "../../project/types";

export const RECENTS_COMMIT_GROUP_ID = "commits-recents";

export const getHistoryItemId = {
  experiment: (experiment: APIExperimentRun | AnyExperimentRun) =>
    `experiment-${
      "experimentId" in experiment ? experiment.experimentId : experiment.id
    }`,
  singleRun: (simulation: SimulationData | Draft<SimulationData>) =>
    `singleRun-${simulation.simulationRunId}`,
  release: (release: ReleaseDescription) => `release-${release.tag}`,

  /**
   * Relying on a commit only ever appearing in one commit group. Using last one
   * as new commits are added to the front of commit groups and we never want
   * this to change for a commit group
   */
  commitGroup: (commitGroup: SimulatorHistoryItemCommitGroup["item"]) =>
    commitGroup.recents
      ? RECENTS_COMMIT_GROUP_ID
      : `commits-${commitGroup.commits[commitGroup.commits.length - 1].id}`,
};

export const historyAdapter = createEntityAdapter<SimulatorHistoryItem>({
  sortComparer: (a, b) => b.createdAt - a.createdAt,
  selectId: (item) => item.historyId,
});
