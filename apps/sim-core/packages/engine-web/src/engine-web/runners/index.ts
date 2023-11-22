import { Observable } from "rxjs";

import { SerializableAgentState as AgentState } from "../../glue";
import {
  ExperimentPromises,
  ExperimentRun,
  ExperimentStreamResponse,
  Project,
} from "../experiments";

export { runnerActions } from "./actions";
export * from "./cloud-runner";
export * from "./wasm-runner";
export * from "./web-runner";
export * from "./worker-runner";

/**
 * @todo this should be an array
 */
export type SimulationStates = { [id: string]: AgentState[] };

export type ReadyHandler = (step: number, state: AgentState[]) => Promise<void>;

export type ExperimentSrc = {
  project: Project;
  manifestSrc: string;
  experimentName: string;
  presetUuid?: string;
  pyodideEnabled: boolean;
};
export type ProviderTargetEnv = "web" | "cloud";
export type ProviderTarget = {
  target: ProviderTargetEnv;
  dedicatedRunner: ExperimentRunner;
  experimentRunners: Map<string, ExperimentRunner>;
};

export type RunnerListener = (message: RunnerStatus) => void;

/**
 * Provides an interface for controlling a group of simulation runs
 */
export interface ExperimentRunner {
  /**
   * Command the worker via a RunnerRequest.
   */
  handleRequest: (
    request: RunnerRequest,
    ...rest: any
  ) => Promise<RunnerStatus>;

  queueExperiment(
    experiment: ExperimentSrc,
  ):
    | Observable<ExperimentStreamResponse>
    | Promise<ExperimentRun & ExperimentPromises>;
}

export type RunnerId = string;
export type SimulationRunId = string;
export type S3Url = string;

export type RunnerStatus = {
  simulationRunId: string | null;
  running: boolean;
  stepsTaken: number;
  pyodideStatus: "loading" | "loaded" | "unused" | "errored";
  runnerError: Error | null;
  accumulatedSteps?: SimulationStates;
  stepsLink: {
    agentSteps?: S3Url;
    analysisOutputs?: S3Url;
  };
  resetting: boolean;
  earlyStop: boolean;
  stopMessage: any;
} & (
  | {
      metricObjective?: undefined;
      metricOutcome?: undefined;
      metricName?: undefined;
    }
  | {
      metricObjective: "min" | "max";
      metricOutcome: number;
      metricName: string;
    }
);

/**
 * Requests to be directed to simulation runners
 * This could be starting/stopping/etc an _individual simulation run_
 */
export type RunnerRequestTypes =
  | {
      type: "initialize";
      manifestSrc: string;
      includeSteps: boolean;
      numSteps: number;
      presetRunId: string | null;
      s3Key?: string;
      pyodideEnabled: boolean;
    }
  | {
      type: "play";
      propertiesSrc?: string;
    }
  | {
      type: "pause";
    }
  | {
      type: "step";
      numSteps: number;
      includeSteps?: boolean;
    }
  | {
      type: "updateComponents";
      propertiesSrc?: string;
    }
  | { type: "status" }
  | {
      type: "getReadySteps";
      omitData?: boolean;
    };

export type RunnerRequest<Type = RunnerRequestTypes["type"]> = Extract<
  RunnerRequestTypes,
  { type: Type }
>;

export type RunnerRequestArgs<K> = Omit<
  Omit<RunnerRequest<K>, "type">,
  "simulationRunId"
>;
