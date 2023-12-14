import { AgentState, WasmLib } from "../../";
import { DatasetCache, HashPyodide, SimulationComponents } from "../simulation";
import { RawManifest, ReadyHandler, RunnerRequest, RunnerStatus } from "../";
import { StateIteratorWrapper } from "../../../wasm/bundler";
import { runnerActions as actions } from "./actions";

export interface RunnerState {
  // Runner controls
  running: boolean;
  stepsLeft: number;
  currentTarget: number;
  stepsTaken: number;

  // Runner info
  simulationRunId: string | null;
  runnerError: Error | null;
  devMode: boolean;

  // Completion
  stepHandler: ReadyHandler | null;

  // Early stopping
  earlyStop: boolean;
  stopMessage: any;

  // Guts
  wasmlib: WasmLib;
  rawManifest: RawManifest | null;
  parsedSimulation: SimulationComponents | null;
  wrapper: StateIteratorWrapper | null;
  datasetCache: DatasetCache;
  accumulatedSteps: { [step: string]: AgentState[] };
  latestState: AgentState[];
  pyodide: HashPyodide | null | "errored";
}

export const WasmRequestHandler = async (
  request: RunnerRequest,
  runner: RunnerState,
): Promise<RunnerStatus> => {
  let includeSteps = false;

  try {
    switch (request.type) {
      case "initialize":
        const initialized = await actions.initialize(request, runner);
        if (initialized) {
          console.log("switching to play", runner.simulationRunId);
          await actions.step(
            {
              numSteps: request.numSteps,
              includeSteps: request.includeSteps,
            },
            runner,
          );
          includeSteps = request.includeSteps;
        }
        break;

      case "play":
        actions.play(request, runner);
        break;

      case "pause":
        actions.pause(runner);
        break;

      case "step":
        await actions.step(request, runner);
        includeSteps = request.includeSteps ?? false;
        break;

      case "updateComponents":
        actions.updateComponents(request, runner);
        break;

      case "getReadySteps":
        await actions.getReadySteps(runner);
        includeSteps = !request.omitData;
        break;
    }
  } catch (err) {
    console.error("Failed handling request", err);
    runner.runnerError = err instanceof Error ? err : null;
  }

  if (runner.runnerError) {
    actions.pause(runner);

    /**
     * Error types cannot cross the web worker boundary in some browsers
     *
     * @todo remove this when we serialize everything
     *    N.B. the stringifier replacer is dropping the context added in
     *    JsCustomBehavior: check if serializing everything fixes this.
     */
    runner.runnerError = JSON.parse(
      JSON.stringify(
        runner.runnerError,
        // JSON.stringify doesn't work by default on error types – this makes it work
        Object.getOwnPropertyNames(runner.runnerError),
      ),
    );
  }

  const {
    runnerError,
    accumulatedSteps,
    running,
    simulationRunId,
    pyodide,
    stepsTaken,
    earlyStop,
    stopMessage,
  } = runner;

  if (includeSteps) {
    runner.accumulatedSteps = {};
  }

  runner.runnerError = null;

  const result: RunnerStatus = {
    running,
    runnerError,
    simulationRunId,
    pyodideStatus:
      pyodide === "errored" ? "errored" : pyodide ? "loaded" : "unused",
    resetting: false,
    accumulatedSteps: {},
    stepsLink: {},
    stepsTaken,
    earlyStop,
    stopMessage,
  };

  if (includeSteps) {
    result.accumulatedSteps = accumulatedSteps;
  }

  return result;
};
