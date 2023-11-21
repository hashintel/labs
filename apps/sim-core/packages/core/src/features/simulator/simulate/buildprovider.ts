import { IS_DEV } from "../../../util/api";
import { SimulationProvider } from "./provider";
import { getLocalStorageSimulatorTarget } from "./target";
import workerUrl from "../../../workers/simulation-worker/index?worker&url";

/**
 * This "magic number" might need to be more sophisticated as time goes on
 * Web workers are not scheduled as well as OS threads, and too many might
 * actually be less performant.
 *
 * Additionally, hardware concurrency is disabled in safari, so we need to check
 * if the flag exists and default to a hardcoded number if it doesn't. We use 4
 * because that's a middle ground between the max (8) and the minimum (2)
 */
const numThreads = (window.navigator.hardwareConcurrency ?? 4) + 1;

/**
 * Spin up a new simulation provider and then dispatch an update to the Ui
 */
export const simulationProvider = new SimulationProvider(
  getLocalStorageSimulatorTarget()
);

/**
 * This is given its own method so Jest skips over it
 * This method should be called when the app loads, after the store is ready
 */
export function buildSimulationProvider(forExperiments: boolean) {
  // Rule of thumb is to create n+1 threads for CPU scheduling
  // We also want to reserve the first runner to not be used by experiments
  simulationProvider.build(workerUrl, forExperiments ? numThreads : 0, IS_DEV);
}
