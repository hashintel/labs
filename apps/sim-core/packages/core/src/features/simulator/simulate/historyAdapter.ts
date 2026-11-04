import { createEntityAdapter } from "../../reduxCompat";
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

  commitGroup: (commitGroup: SimulatorHistoryItemCommitGroup["item"]) =>
    commitGroup.recents
      ? RECENTS_COMMIT_GROUP_ID
      : `commits-${commitGroup.commits[commitGroup.commits.length - 1].id}`,
};

export const historyAdapter = createEntityAdapter<SimulatorHistoryItem>({
  sortComparer: (a, b) => b.createdAt - a.createdAt,
  selectId: (item) => item.historyId,
});
