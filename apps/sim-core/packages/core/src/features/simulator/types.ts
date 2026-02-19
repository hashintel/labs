import type { AnyAction, Store } from "../reduxCompat";
import type { SimulatorSlice } from "./simulate/types";

export type SimulatorRootState = {
  simulator: SimulatorSlice;
};

export type SimulatorDispatch = (action: AnyAction | SimulatorThunk<any>) => any;

export type SimulatorThunk<ReturnType = void> = (
  dispatch: SimulatorDispatch,
  getState: () => SimulatorRootState,
) => ReturnType;

export type SimulatorStore = Store<SimulatorRootState>;
