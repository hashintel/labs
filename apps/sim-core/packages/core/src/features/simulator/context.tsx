import React, {
  FC,
  PropsWithChildren,
  useCallback,
  useRef,
  useSyncExternalStore,
} from "react";

import type { SimulatorDispatch, SimulatorRootState } from "./types";
import { simulatorStore } from "./store";

export const useSimulatorStore = () => simulatorStore;

/** Shallow compare for arrays to avoid useSyncExternalStore infinite loop */
function shallowEqualArrays(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.every((x, idx) => x === b[idx]);
  }
  return false;
}

export const useSimulatorSelector = <TSelected = unknown,>(
  selector: (state: SimulatorRootState) => TSelected,
): TSelected => {
  const cachedRef = useRef<{ value: TSelected } | null>(null);

  const getSnapshot = useCallback(() => {
    const next = selector(simulatorStore.getState());
    if (cachedRef.current === null) {
      cachedRef.current = { value: next };
      return next;
    }
    if (
      cachedRef.current.value === next ||
      shallowEqualArrays(cachedRef.current.value, next)
    ) {
      return cachedRef.current.value;
    }
    cachedRef.current = { value: next };
    return next;
  }, [selector]);

  return useSyncExternalStore(
    simulatorStore.subscribe,
    getSnapshot,
    getSnapshot,
  );
};

export const useSimulatorDispatch = (): SimulatorDispatch =>
  simulatorStore.dispatch;

export const SimulatorProvider: FC<PropsWithChildren> = ({ children }) => (
  <>{children}</>
);
