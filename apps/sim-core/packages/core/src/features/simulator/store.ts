import { configureStore } from "@reduxjs/toolkit";

import { SimulatorRootState } from "./types";
import { historySubscriber } from "./simulate/historySubscriber";
import { observeMiddleware } from "../utils";
import { playbackSubscriber } from "./simulate/playbackSubscriber";
import { runningSubscriber } from "./simulate/runningSubscriber";
import { simulationReducer as simulator } from "./simulate/slice";
import { simulatorAnalysisMiddleware } from "./simulate/analysisMiddleware";
import { simulatorMiddleware } from "./simulate/middleware";
import { simulatorStoreActionObservable } from "./actionObservable";

export const simulatorStore = configureStore({
  reducer: { simulator },
  devTools: false,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      immutableCheck: false,
      serializableCheck: false,
    }).concat([
      simulatorMiddleware,
      observeMiddleware<SimulatorRootState>(simulatorStoreActionObservable),
      simulatorAnalysisMiddleware,
    ]),
});

simulatorStore.subscribe(playbackSubscriber(simulatorStore));
simulatorStore.subscribe(runningSubscriber(simulatorStore));
simulatorStore.subscribe(historySubscriber(simulatorStore));
