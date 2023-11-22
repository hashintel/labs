import { ExperimentRun } from "@hashintel/engine-web";

export interface NamedBehaviorSrc {
  name: string;
  shortname: string;
  behaviorSrc: string;
  id?: string;

  /**
   * @todo this field is unused I believe – remove it?
   */
  dependencies: string[];
}

export interface InitSrc {
  id: string;
  name: string;
  initSrc: string;
}

export interface SimulationSrc {
  initializers: InitSrc[];
  propertiesSrc: string;
  behaviors: NamedBehaviorSrc[];
  analysisSrc: string;
  dependenciesSrc: string;
  experimentsSrc: string;
}

/**
 * @deprecated
 * @use auto generated types
 * @todo remove this
 */
export interface APISimulationRun {
  id: string;
  stepsLink?: string | null;
  analysisLink?: string | null;
  propertyValues: Record<string, number>;
  metricOutcome?: number | null;
}

/**
 * @deprecated
 * @use auto generated types
 * @todo remove this
 */
export interface APIExperimentRun {
  id: string;
  name: string;
  experimentSrc: any;
  simulationRuns: APISimulationRun[];
  createdAt: string;
  packageData?: {
    metricObjective?: ExperimentRun["metricObjective"] | null;
    metricName?: string | null;
  };
}
