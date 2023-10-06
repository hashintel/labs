import { Action, CombinedState, ThunkAction } from "@reduxjs/toolkit";

import type { SimulatorSlice } from "./simulate/types";
import { simulatorStore } from "./store";

export type SimulatorRootState = CombinedState<{
  simulator: SimulatorSlice;
}>;

export type SimulatorDispatch = typeof simulatorStore.dispatch;

export type SimulatorThunk<ReturnType = void> = ThunkAction<
  ReturnType,
  SimulatorRootState,
  unknown,
  Action<string>
>;

export type SimulatorStore = typeof simulatorStore;
