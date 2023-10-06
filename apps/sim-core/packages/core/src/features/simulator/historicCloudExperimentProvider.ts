// @todo reduce duplication between analysis/steps in this file
import { ExperimentRun, SimulationStates } from "@hashintel/engine-web";
import { UseStore, createStore, del, get, set } from "idb-keyval";

import { SimulationAnalysis, SimulationData } from "./simulate/types";

let experimentDataStoreIdb: Promise<UseStore> | null = new Promise(
  (resolve) => {
    const store = createStore("hash", "experiment-data");

    get("test-key", store)
      .then(() => resolve(store))
      .catch((err) => {
        console.warn(
          "indexdb store creation failed. Local caching will be unavailable",
          err
        );
        experimentDataStoreIdb = null;
      });
  }
);

const experimentKey = (experimentId: string) => `experiment.${experimentId}`;

const experimentSimulationStepsKey = (
  experimentId: string,
  simulationId: string
) => `${experimentKey(experimentId)}.run.${simulationId}`;

const experimentSimulationAnalysisKey = (
  experimentId: string,
  simulationId: string
) => `${experimentKey(experimentId)}.run.${simulationId}.analysis`;

const idbGet = <T>(key: string) =>
  experimentDataStoreIdb
    ? experimentDataStoreIdb
        .then((store) => get<T | null>(key, store))
        .catch((err) => {
          console.warn("indexdb failed to get", key, err);
          return null;
        })
    : Promise.resolve(null);

const idbSet = <T extends any>(key: string, value: T) => {
  if (experimentDataStoreIdb) {
    if (value === undefined || value === null) {
      return experimentDataStoreIdb
        .then((store) => del(key, store))
        .catch((err) => {
          console.warn("indexdb failed to del", key, err);
        });
    }

    return experimentDataStoreIdb
      .then((store) => set(key, value, store))
      .catch((err) => {
        console.warn("indexdb failed to set", key, err);
      });
  }

  return Promise.resolve();
};

const getIdbSteps = async (
  experimentId: string,
  simulationId: string
): Promise<SimulationStates | null> => {
  const json = await idbGet<string | null>(
    experimentSimulationStepsKey(experimentId, simulationId)
  );

  return typeof json === "string" ? JSON.parse(json) : null;
};

const getIdbAnalysis = async (
  experimentId: string,
  simulationId: string
): Promise<SimulationStates | null> => {
  const json = await idbGet<string | null>(
    experimentSimulationAnalysisKey(experimentId, simulationId)
  );

  return typeof json === "string" ? JSON.parse(json) : null;
};

type SimulationWithStepsLink = Omit<SimulationData, "stepsLink"> & {
  stepsLink: NonNullable<SimulationData["stepsLink"]>;
};

type SimulationWithAnalysisLink = Omit<SimulationData, "analysisLink"> & {
  analysisLink: NonNullable<SimulationData["analysisLink"]>;
};

const hasStepsLink = (
  simulation: SimulationData
): simulation is SimulationWithStepsLink => !!simulation.stepsLink;

const hasAnalysisLink = (
  simulation: SimulationData
): simulation is SimulationWithAnalysisLink => !!simulation.analysisLink;

const getNetworkSteps = async (
  experiment: ExperimentRun,
  run: SimulationWithStepsLink,
  signal: AbortSignal
) =>
  fetch(run.stepsLink, {
    signal: signal,
  })
    .then((req) => (req.ok ? req.text() : null))
    .then(async (text) => {
      if (text !== null && !signal.aborted) {
        await historicCloudExperimentProvider.setStepsRaw(
          experiment.experimentId,
          run.simulationRunId,
          text
        );

        return JSON.parse(text);
      }
    });

const getNetworkAnalysis = async (
  experiment: ExperimentRun,
  run: SimulationWithAnalysisLink,
  signal: AbortSignal
) =>
  fetch(run.analysisLink, {
    signal: signal,
  })
    .then((req) => (req.ok ? req.text() : null))
    .then(async (text) => {
      if (text !== null && !signal.aborted) {
        await historicCloudExperimentProvider.setAnalysisRaw(
          experiment.experimentId,
          run.simulationRunId,
          text
        );

        return JSON.parse(text);
      }
    });

const stepRequests: Record<string, Promise<SimulationStates>> = {};

export const historicCloudExperimentProvider = {
  async getSteps(
    experiment: ExperimentRun,
    run: SimulationData
  ): Promise<SimulationStates> {
    if (hasStepsLink(run)) {
      if (stepRequests[run.simulationRunId]) {
        return stepRequests[run.simulationRunId].catch(() =>
          historicCloudExperimentProvider.getSteps(experiment, run)
        );
      }

      stepRequests[run.simulationRunId] = (async () => {
        const abortController = new AbortController();

        const dbStepsPromise = getIdbSteps(
          experiment.experimentId,
          run.simulationRunId
        ).then((steps) => {
          if (steps) {
            abortController.abort();
          }

          return steps;
        });

        const networkStepsPromise = getNetworkSteps(
          experiment,
          run,
          abortController.signal
        );

        const steps = await Promise.race([dbStepsPromise, networkStepsPromise])
          .then((steps) => steps ?? networkStepsPromise)
          .catch((err) => {
            if (err.name !== "AbortError") {
              throw err;
            }

            return dbStepsPromise;
          });

        if (steps) {
          return steps;
        }
      })();

      const steps = await stepRequests[run.simulationRunId];

      if (steps) {
        delete stepRequests[run.simulationRunId];

        return steps;
      }
    }

    throw new Error("Could not get steps for cloud experiment");
  },
  setSteps: (
    experimentId: string,
    simulationId: string,
    steps: SimulationStates | null
  ) =>
    idbSet(
      experimentSimulationStepsKey(experimentId, simulationId),
      JSON.stringify(steps)
    ),
  setStepsRaw: (
    experimentId: string,
    simulationId: string,
    stepsText: string
  ) =>
    idbSet(experimentSimulationStepsKey(experimentId, simulationId), stepsText),

  async getAnalysis(
    experiment: ExperimentRun,
    run: SimulationData
  ): Promise<SimulationAnalysis> {
    if (hasAnalysisLink(run)) {
      const abortController = new AbortController();
      const dbAnalysisPromise = getIdbAnalysis(
        experiment.experimentId,
        run.simulationRunId
      ).then((analysis) => {
        if (analysis) {
          abortController.abort();
        }

        return analysis;
      });

      const networkAnalysisPromise = getNetworkAnalysis(
        experiment,
        run,
        abortController.signal
      );

      const analysis = await Promise.race([
        dbAnalysisPromise,
        networkAnalysisPromise,
      ])
        .then((analysis) => analysis ?? networkAnalysisPromise)
        .catch((err) => {
          if (err.name !== "AbortError") {
            throw err;
          }

          return dbAnalysisPromise;
        });

      if (analysis) {
        return analysis;
      }
    }

    throw new Error("Could not get analysis for cloud experiment");
  },

  setAnalysis: (
    experimentId: string,
    simulationId: string,
    analysis: SimulationAnalysis | null
  ) =>
    idbSet(
      experimentSimulationAnalysisKey(experimentId, simulationId),
      JSON.stringify(analysis)
    ),
  setAnalysisRaw: (
    experimentId: string,
    simulationId: string,
    analysisText: string
  ) =>
    idbSet(
      experimentSimulationAnalysisKey(experimentId, simulationId),
      analysisText
    ),
};
