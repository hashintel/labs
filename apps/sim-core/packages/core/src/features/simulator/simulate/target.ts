import { ProviderTargetEnv } from "@hashintel/engine-web";

const SIMULATOR_TARGET_KEY = "simulator.target";

export const DEFAULT_SIMULATOR_TARGET: ProviderTargetEnv = "cloud";

const getUnsafeLocalStorageSimulatorTarget = () => {
  try {
    return localStorage.getItem(SIMULATOR_TARGET_KEY) as ProviderTargetEnv;
  } catch {
    // Some browsers will disable localstorage.
  }

  return null;
};

export const hasLocalStorageSimulatorTarget = () =>
  !!getUnsafeLocalStorageSimulatorTarget();

export const getLocalStorageSimulatorTarget = (): ProviderTargetEnv =>
  getUnsafeLocalStorageSimulatorTarget() ?? DEFAULT_SIMULATOR_TARGET;

export const setLocalStorageSimulatorTarget = (target: ProviderTargetEnv) => {
  try {
    localStorage.setItem(SIMULATOR_TARGET_KEY, target);
  } catch {
    // Some browsers will disable localstorage.
  }
};
