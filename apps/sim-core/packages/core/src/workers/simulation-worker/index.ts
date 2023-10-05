import RegisterPromiseWorker from "promise-worker-transferable/register";
import { RunnerState, WasmRequestHandler, wasm } from "@hashintel/engine-web";

const runner: Promise<RunnerState> = (async () => ({
  // Mechanical
  wasmlib: await wasm(),
  datasetCache: new Map(),
  pyodide: null,

  // Simulation
  rawManifest: null,
  accumulatedSteps: {},
  parsedSimulation: null,
  latestState: [],

  // Controls
  running: false,
  stepsLeft: 0,
  currentTarget: 0,
  stepsTaken: 0,

  // Early stopping
  earlyStop: false,
  stopMessage: null,

  // Info
  simulationId: null,
  runnerId: "",
  wrapper: null,
  runnerError: null,
  devMode: false,

  stepHandler: null,
  simulationRunId: null,
}))();

RegisterPromiseWorker(async (message) => {
  return typeof message === "object"
    ? await WasmRequestHandler(message, await runner)
    : null;
});
