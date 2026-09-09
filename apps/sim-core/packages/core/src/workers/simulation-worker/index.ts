import RegisterPromiseWorker from "promise-worker-transferable/register";
import {
  RunnerState,
  RunnerStatus,
  WasmRequestHandler,
  wasm,
} from "@hashintel/engine-web";

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

// Serialize message handling: promise-worker-transferable fires each incoming
// message callback without awaiting the previous one.  For an async handler
// like WasmRequestHandler that mutates shared RunnerState, concurrent
// invocations cause data races (e.g. `initialize` setting a new
// simulationRunId while a stale `getReadySteps` is still building its
// response).  This queue ensures handlers execute one at a time.
let handlerQueue: Promise<void> = Promise.resolve();

RegisterPromiseWorker((message) => {
  if (typeof message !== "object") return null;

  return new Promise<RunnerStatus>((resolve, reject) => {
    handlerQueue = handlerQueue
      .then(async () => {
        resolve(await WasmRequestHandler(message, await runner));
      })
      .catch((err) => {
        reject(err);
      });
  });
});
