import { Observable } from "rxjs";

import { MonteDistributions } from "./montecarlo";
import { RawManifest } from "../simulation/types";
import { RunnerStatus } from "../runners";

type ExperimentArgs =
  | { type: "values"; steps: number; field: string; values: any[] }
  | {
      type: "linspace";
      start: number;
      stop: number;
      samples: number;
      steps: number;
      field: string;
    }
  | {
      type: "meshgrid";
      steps: number;

      xfield: string;
      // start, stop, numsamples
      x: [number, number, number];

      yfield: string;
      // start, stop, numsamples
      y: [number, number, number];
    }
  | {
      type: "multiparameter";
      steps: number;
      runs: string[];
    }
  | {
      type: "arange";
      field: string;
      start: number;
      stop: number;
      increment: number;
      steps: number;
    }

  // All distributions generated from 0-1
  | ({
      type: "monte-carlo";
      steps: number;
      samples: number;
      field: string;
    } & MonteDistributions)
  | { type: "group"; runs: string[]; steps: number }
  | {
      type: "optimization";
      metricObjective: "min" | "max";
      maxSteps: number;
      metricName: string;
    };

// Provide a generic type for experiment definitions to narrow down the definition type
export type ExperimentDefinition<Type = ExperimentArgs["type"]> = Extract<
  ExperimentArgs,
  {
    type: Type;
  }
>;

export type Project = {
  path: string;
  ref: string;
};

export type ExperimentRun = {
  // Corresponds to the user's name for the definition
  project: Project;
  target: "cloud" | "web";
  experimentName: string;
  experimentId: string;
  status: "queued" | "running" | "completed" | "errored" | "stopping";
  definition: ExperimentDefinition;
  simulationIds: string[];
  plan: ExperimentPlan;
  startedTime: number;
  metricObjective?: RunnerStatus["metricObjective"];
  metricOutcome?: RunnerStatus["metricOutcome"];
};

type ExperimentStreamCommon = { simulationId: string };

/**
 * @todo simulationId on this type cannot be null
 */
export type ExperimentStreamAnalysis = ExperimentStreamCommon & {
  type: "analysis";
  status: RunnerStatus;
  link: string;
};

export type ExperimentStreamResponse =
  | {
      type: "queued";
      experiment: ExperimentRun;
    }
  | {
      type: "simulationsCreated";
      plan: ExperimentPlan;
    }
  | {
      type: "stopping";
    }
  | (ExperimentStreamCommon &
      (
        | { type: "started" }
        | ExperimentStreamAnalysis
        | { type: "steps"; status: RunnerStatus }
        | {
            type: "error";
            error: NonNullable<RunnerStatus["runnerError"]>;
          }
        | {
            type: "earlyStop";
            status: RunnerStatus;
          }
      ));

/**
 * @deprecated
 * @todo remove this
 */
export type ExperimentPromises = {
  /**
   * @deprecated
   */
  runPromises: {
    [id: string]: Promise<RunnerStatus>;
  };
  /**
   * @deprecated
   */
  startedPromises: {
    [id: string]: Promise<void>;
  };
  experimentPromise: Promise<void>;
};

export type PlannedRunVariant = {
  [id: string]: any;
};

export type ExperimentPlanEntry = {
  fields: PlannedRunVariant;
};

export type ExperimentPlan = {
  [id: string]: ExperimentPlanEntry;
};

export type QueuedExperimentRun = ExperimentRun & {
  manifest: RawManifest;

  queuedSimulationRunIds: Set<string>;
};

export type ParsedExperimentDefinitions = {
  [id: string]: ExperimentDefinition;
};

/**
 * Create an externally resolvable promise
 *
 * @deprecated
 */
export class DeferredPromise<T> {
  _promise: Promise<T>;
  resolve: (val: T) => void = () => {};
  reject: (err: Error) => void = () => {};
  then: Promise<T>["then"];
  catch: Promise<T>["catch"];
  finally: Promise<T>["finally"];

  [Symbol.toStringTag]: string;
  constructor(existingPromise?: Promise<T>) {
    this._promise = new Promise((resolve, reject) => {
      // assign the resolve and reject functions to `this`
      // making them usable on the class instance
      this.resolve = resolve;
      this.reject = reject;
      if (existingPromise) {
        existingPromise.then(resolve).catch(reject);
      }
    });

    // bind `then` and `catch` to implement the same interface as Promise
    this.then = this._promise.then.bind(this._promise);
    this.catch = this._promise.catch.bind(this._promise);
    this.finally = this._promise.finally.bind(this._promise);

    this[Symbol.toStringTag] = "Promise";
  }
}

type WithoutOptimization<
  Definition extends ExperimentDefinition
> = Definition extends ExperimentDefinition<"optimization">
  ? never
  : Definition;

export type ExperimentDefinitionWithoutOptimization = WithoutOptimization<ExperimentDefinition>;

export type QueuedExperimentRunWithoutOptimization = Omit<
  QueuedExperimentRun,
  "definition"
> & { definition: ExperimentDefinitionWithoutOptimization };
