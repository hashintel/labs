import React, { FC, PropsWithChildren, useCallback, useSyncExternalStore } from "react";

import type { SimulatorDispatch, SimulatorRootState } from "./types";
import { simulatorStore } from "./store";

export const useSimulatorStore = () => simulatorStore;

export const useSimulatorSelector = <TSelected = unknown>(
  selector: (state: SimulatorRootState) => TSelected,
): TSelected => {
  return useSyncExternalStore(
    simulatorStore.subscribe,
    useCallback(() => selector(simulatorStore.getState()), [selector]),
  );
};

export const useSimulatorDispatch = (): SimulatorDispatch =>
  simulatorStore.dispatch;

export const SimulatorProvider: FC<PropsWithChildren> = ({ children }) => (
  <>{children}</>
);
