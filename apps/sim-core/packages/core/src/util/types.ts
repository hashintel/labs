import { ExperimentRun } from "@hashintel/engine-web";

export type NamedBehaviorSrc = {
  name: string;
  shortname: string;
  behaviorSrc: string;
  id?: string;

  /**
   * @todo this field is unused I believe – remove it?
   */
  dependencies: string[];
};

export type InitSrc = {
  id: string;
  name: string;
  initSrc: string;
};

export type SimulationSrc = {
  initializers: InitSrc[];
  propertiesSrc: string;
  behaviors: NamedBehaviorSrc[];
  analysisSrc: string;
  dependenciesSrc: string;
  experimentsSrc: string;
};

/**
 * @deprecated
 * @use auto generated types
 * @todo remove this
 */
export type APISimulationRun = {
  id: string;
  stepsLink?: string | null;
  analysisLink?: string | null;
  propertyValues: {
    [key: string]: number;
  };
  metricOutcome?: number | null;
};

/**
 * @deprecated
 * @use auto generated types
 * @todo remove this
 */
export type APIExperimentRun = {
  id: string;
  name: string;
  experimentSrc: any;
  simulationRuns: APISimulationRun[];
  createdAt: string;
  packageData?: {
    metricObjective?: ExperimentRun["metricObjective"] | null;
    metricName?: string | null;
  };
};
