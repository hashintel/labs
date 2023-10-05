import { check } from "prettier";
import { v4 as uuid } from "uuid";

import {
  AgentState,
  RunnerRequestArgs,
  RunnerState,
  SimulationComponents,
  WasmLib,
  isPyodideLoaded,
  refreshPyodideDatasetCache,
  simulationFromRequest,
  updatePythonGlobals,
} from "../../";

/**
 * Build the state iterator wrapper from the components
 */
const rebuildWrapper = (
  wasmlib: WasmLib,
  components: SimulationComponents,
  fromState: AgentState[]
) =>
  wasmlib.start_simulation(
    fromState,
    components?.properties,
    components?.datasets,
    components?.behaviors,
    components?.handlers
  );

/**
 * Run the current simulation with the current control values
 */
const runSim = async (runner: RunnerState) => {
  const iter = runner.wrapper?.get_iter();

  while (runner.stepsLeft > 0 && runner.running && runner.wrapper && iter) {
    const msStart = runner.devMode ? Date.now() : 0;
    const newState: AgentState[] = await runner.wasmlib.next_state(iter);

    if (runner.devMode) {
      console.log(`State obtained in ${Date.now() - msStart}ms`);
    }

    const stop = runner.parsedSimulation?.behaviors.updateAgentCache(newState);

    runner.accumulatedSteps[runner.stepsTaken + 1] = newState;
    runner.latestState = newState;

    // Update our control signals
    runner.stepsTaken += 1;
    runner.stepsLeft -= 1;

    // awaiting the runner might be instant, so we need to prevent the thread from locking
    await new Promise((resolve) => setImmediate(resolve));

    if (runner.stepHandler) {
      await runner.stepHandler(runner.stepsTaken + 1, newState);
    }

    if (stop) {
      runner.earlyStop = true;
      runner.stopMessage = stop.data;
      break;
    }
  }

  runner.running = false;
};

const initialize = async (
  request: RunnerRequestArgs<"initialize">,
  runner: RunnerState
) => {
  if (runner.wrapper) {
    runner.wrapper.free();
    runner.wrapper = null;
  }

  // Prep the runner
  runner.simulationRunId = request.presetRunId ?? uuid();
  runner.stepsLeft = request.numSteps;
  runner.stepsTaken = 0;
  runner.earlyStop = false;
  runner.stopMessage = null;

  // Get the components to build the simulation
  try {
    runner.parsedSimulation = await simulationFromRequest(
      request.manifestSrc,
      runner.datasetCache,
      request.pyodideEnabled
    );
  } catch (err) {
    if (err.message === "Cannot load pyodide") {
      runner.pyodide = "errored";
      return false;
    } else {
      throw err;
    }
  }

  if (runner.pyodide === "errored") {
    runner.pyodide = null;
  }

  // Refresh our caches.
  if (isPyodideLoaded()) {
    await refreshPyodideDatasetCache(runner.datasetCache);
    updatePythonGlobals(JSON.stringify(runner.parsedSimulation.properties));
  }

  const initialState = runner.parsedSimulation.initializer.apply();

  // Uses this.parsedSimulation to build a new simulation wrapper
  runner.wrapper = rebuildWrapper(
    runner.wasmlib,
    runner.parsedSimulation,
    initialState
  );

  runner.latestState = runner.wrapper.initial_state() as AgentState[];
  runner.parsedSimulation.behaviors.updateAgentCache(runner.latestState);

  // Add the initial state to the accumulated steps
  // So when we give our response, the initial state is there
  runner.accumulatedSteps = { 0: runner.latestState };

  // Ensure the behavior's properties are up to date
  runner.parsedSimulation.behaviors.updateProperties(
    runner.parsedSimulation.properties
  );

  return true;
};

// Step N steps and then give a response
const step = async (
  request: RunnerRequestArgs<"step">,
  runner: RunnerState
) => {
  if (runner.earlyStop) {
    return;
  }
  runner.stepsLeft = request.numSteps;
  runner.running = true;

  await runSim(runner).catch((err) => {
    runner.runnerError = err;
  });
};

const play = (request: RunnerRequestArgs<"play">, runner: RunnerState) => {
  if (runner.earlyStop) {
    return;
  }
  if (runner.simulationRunId) {
    updateComponents({ propertiesSrc: request.propertiesSrc }, runner);
    runner.stepsLeft = 100000000;
    runner.running = true;

    runSim(runner).catch((err) => {
      runner.runnerError = err;
    });
  }
};

const pause = (runner: RunnerState) => {
  runner.running = false;
};

/**
 * Unfortunately we have no way of being told when accumulatedSteps has been
 * updated, so we're just going to have to poll…
 *
 * @todo change this to be notified
 */
const getReadySteps = async (runner: RunnerState) => {
  // Return steps that are available, waiting a bit if nothing is ready
  while (
    runner.running &&
    Object.values(runner.accumulatedSteps).length === 0 &&
    !runner.runnerError
  ) {
    await new Promise((r) => setTimeout(r, 40));
  }

  return {
    StepsRequested: true,
  };
};

/**
 * Update the wrapper with new components that come down the pipeline.
 * Currently only implemented for properties, feel free to expand later
 */
const updateComponents = (
  request: RunnerRequestArgs<"updateComponents">,
  runner: RunnerState
) => {
  try {
    if (runner.parsedSimulation) {
      if (request.propertiesSrc) {
        const props = JSON.parse(request.propertiesSrc);

        runner.parsedSimulation.properties = props;
        runner.parsedSimulation.behaviors.updateProperties(props);
        updatePythonGlobals(request.propertiesSrc);
      }

      /**
       * Only rebuild with a new initial state if we were given a new initial
       * state. Otherwise, pick off where we left off
       */
      runner.wrapper = rebuildWrapper(
        runner.wasmlib,
        runner.parsedSimulation,
        runner.latestState
      );
    }
  } catch (err) {
    runner.running = false;
    throw err;
  }
};

/**
 * Other sources uses this file, but don't support importing the file as its exports
 * Particularly, node prefers having an object rather than a `glob as` import
 */
export const runnerActions = {
  rebuildWrapper,
  runSim,
  initialize,
  step,
  pause,
  getReadySteps,
  updateComponents,
  play,
};
