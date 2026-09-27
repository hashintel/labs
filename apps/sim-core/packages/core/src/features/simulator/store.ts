import { createStore } from "../reduxCompat";
import type { AnyAction, Middleware } from "../reduxCompat";

import { SimulatorRootState } from "./types";
import { historySubscriber } from "./simulate/historySubscriber";
import { observeMiddleware } from "../utils";
import { playbackSubscriber } from "./simulate/playbackSubscriber";
import { runningSubscriber } from "./simulate/runningSubscriber";
import { simulationReducer as simulator } from "./simulate/slice";
import { simulatorAnalysisMiddleware } from "./simulate/analysisMiddleware";
import { simulatorMiddleware } from "./simulate/middleware";
import { simulatorStoreActionObservable } from "./actionObservable";

const rootReducer = (
  state: SimulatorRootState | undefined,
  action: AnyAction,
): SimulatorRootState => ({
  simulator: simulator(state?.simulator, action),
});

export const simulatorStore = createStore<SimulatorRootState>(rootReducer, [
  simulatorMiddleware as Middleware<SimulatorRootState>,
  observeMiddleware<SimulatorRootState>(simulatorStoreActionObservable),
  simulatorAnalysisMiddleware as Middleware<SimulatorRootState>,
]);

simulatorStore.subscribe(playbackSubscriber(simulatorStore));
simulatorStore.subscribe(runningSubscriber(simulatorStore));
simulatorStore.subscribe(historySubscriber(simulatorStore));
