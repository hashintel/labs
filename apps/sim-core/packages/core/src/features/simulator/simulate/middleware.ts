import { Middleware } from "@reduxjs/toolkit";

import { IS_DEV } from "../../../util/api";
import type { SimulatorDispatch, SimulatorRootState } from "../types";
import { addUserAlert } from "../../viewer";
import { store as appStore } from "../../store";
import { downloadStepsForRun, earlyStopSimulation } from "./thunks";
import { initializeExperiment, simulationRunUpdated } from "./slice";
import { selectCurrentSimulationData, selectProviderTarget } from "./selectors";
import { simulationProvider } from "./buildprovider";

const MAX_TIMEOUT = 100;

const maxTimeoutWhitelist = [initializeExperiment.type];

export const simulatorMiddleware: Middleware<{}, SimulatorRootState> = (
  store,
) => {
  const dispatch = store.dispatch as SimulatorDispatch;

  simulationProvider.subscribe((message) => {
    if (message.simulationRunId && message.earlyStop) {
      dispatch(
        earlyStopSimulation(message.simulationRunId, message.stopMessage),
      );
    }

    /**
     * This may contain steps that were requested before we're paused, but now
     * that we're paused we no longer want. We cannot just ignore them because
     * they'll have been cleared from the runner's cache.
     *
     * @todo introduce a reject steps message
     */
    dispatch(simulationRunUpdated(message));

    if (message.runnerError) {
      appStore.dispatch(
        addUserAlert({
          type: "error",
          message: message.runnerError.message ?? "error",
          context: "",
          timestamp: Date.now(),
          simulationId: message.simulationRunId,
        }),
      );
    }
  });

  return (next) => {
    return (action) => {
      const prevState = store.getState();
      const now = performance.now();
      const res = next(action);

      if (IS_DEV) {
        const time = performance.now() - now;

        if (time >= MAX_TIMEOUT && !maxTimeoutWhitelist.includes(action.type)) {
          console.warn(
            `Simulator store action took longer than ${MAX_TIMEOUT}ms to process. Time taken: `,
            time,
            "Action:",
            action.type,
            action,
          );
        }
      }

      const nextState = store.getState();
      simulationProvider.target = selectProviderTarget(nextState);

      const run = selectCurrentSimulationData(nextState);
      const prevRun = selectCurrentSimulationData(prevState);

      if (run && run.simulationRunId !== prevRun?.simulationRunId) {
        dispatch(downloadStepsForRun(run));
      }

      return res;
    };
  };
};
