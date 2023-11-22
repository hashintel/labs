import { createSelector, Store } from "@reduxjs/toolkit";

import { SimulationData } from "./types";
import { SimulatorRootState } from "../types";
import { store as appStore } from "../../store";
import { runnerMessage } from "./util";
import {
  selectAllSimulationData,
  selectCurrentSimulationId,
} from "./selectors";
import { selectCurrentProject } from "../../project/selectors";
import { trackEvent } from "../../analytics";

interface RunningState {
  controller: AbortController | null;
  status: SimulationData["status"];
}

const getDefaultRunningState = (sim: SimulationData): RunningState => ({
  status: sim.status,
  controller: null,
});

export const runningSubscriber = (store: Store<SimulatorRootState>) => {
  const run = async (simulationId: string, signal: AbortSignal) => {
    const selectSimRunning = createSelector(
      selectAllSimulationData,
      (data) => data[simulationId]?.status === "running",
    );

    const selectSimCurrent = createSelector(
      selectCurrentSimulationId,
      (id) => id === simulationId,
    );

    const running = () => selectSimRunning(store.getState());

    if (running() && !signal.aborted) {
      const project = selectCurrentProject(appStore.getState());
      appStore.dispatch(
        trackEvent({
          action: "Run Simulation",
          label: `${project!.name} - ${project!.id}`,
        }),
      );

      await runnerMessage({ type: "play" }, simulationId);
    }

    while (running() && !signal.aborted) {
      const needSteps = selectSimCurrent(store.getState());

      await runnerMessage(
        {
          type: "getReadySteps",
          omitData: !needSteps,
        },
        simulationId,
      );
    }

    runnerMessage({ type: "pause" }, simulationId).catch((err) => {
      console.error("Cannot pause simulation", err);
    });
  };

  const simData = selectAllSimulationData(store.getState());
  const runningState: Record<string, RunningState> = Object.fromEntries(
    Object.values(simData).map((sim) => [
      sim.simulationRunId,
      getDefaultRunningState(sim),
    ]),
  );

  return () => {
    const simData = selectAllSimulationData(store.getState());

    for (const [id, simRunningState] of Object.entries(runningState)) {
      if (!simData[id]) {
        simRunningState.controller?.abort();
        delete runningState[id];
      }
    }

    for (const sim of Object.values(simData)) {
      const id = sim.simulationRunId;

      if (!runningState[id]) {
        runningState[id] = getDefaultRunningState(sim);
      }

      if (!sim.experimentId && sim.status !== runningState[id].status) {
        runningState[id].controller?.abort();
        runningState[id].controller = null;
        runningState[id].status = sim.status;

        if (sim.status === "running") {
          const controller = new AbortController();
          run(id, controller.signal).catch((err) => {
            console.error("Cannot run simulation", err);
          });
          runningState[id].controller = controller;
        }
      }
    }
  };
};
