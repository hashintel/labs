import { Result } from "neverthrow";

import { ReactSelectOption } from "../../Dropdown/types";

export enum ExperimentTypes {
  values = "values",
  linspace = "linspace",
  arange = "arange",
  monteCarlo = "monte-carlo",
  group = "group",
  multiparameter = "multiparameter",
  optimization = "optimization",
}

export enum DistributionTypes {
  normal = "normal",
  logNormal = "log-normal",
  poisson = "poisson",
  beta = "beta",
  gamma = "gamma",
}

export type FormDataDynamicFieldValuesType = {
  steps: number;
  field: ReactSelectOption;
  values: string;
};
export type FormDataDynamicFieldValuesErrorsType = {
  steps?: string;
  field?: string;
  values?: string;
};

export type FormDataDynamicFieldLinspaceType = {
  steps: number;
  field: ReactSelectOption;
  start: number;
  stop: number;
  samples: number;
};
export type FormDataDynamicFieldLinspaceErrorsType = {
  steps?: string;
  field?: string;
  start?: string;
  stop?: string;
  samples?: string;
};

export type FormDataDynamicFieldArangeType = {
  steps: number;
  field: ReactSelectOption;
  start: number;
  stop: number;
  increment: number;
};
export type FormDataDynamicFieldArangeErrorsType = {
  steps?: string;
  field?: string;
  start?: string;
  stop?: string;
  increment?: string;
};

export type FormDataDynamicFieldMonteCarloType = {
  steps: number;
  field: ReactSelectOption;
  samples: number;
  distribution: ReactSelectOption;
  mean?: number;
  std?: number;
  mu?: number;
  sigma?: number;
  rate?: number;
  alpha?: number;
  beta?: number;
  shape?: number;
  scale?: number;
};
export type FormDataDynamicFieldMonteCarloErrorsType = {
  steps?: string;
  field?: string;
  samples?: string;
  distribution?: string;
  mean?: string;
  std?: string;
  mu?: string;
  sigma?: string;
  rate?: string;
  alpha?: string;
  beta?: string;
  shape?: string;
  scale?: string;
};

export type FormDataDynamicFieldGroupType = {
  steps: number;
  runs: ReactSelectOption[] | null;
};
export type FormDataDynamicFieldGroupErrorsType = {
  steps?: string;
  runs?: string;
};

export type FormDataDynamicFieldMultiparameterType = {
  steps: number;
  runs: ReactSelectOption[] | null; // Used for react-select multi item
};
export type FormDataDynamicFieldMultiparameterErrorsType = {
  steps?: string;
  runs?: string;
};

export enum FormDataDynamicFieldOptimizationMetricObjective {
  min = "min",
  max = "max",
}

export type FormDataDynamicFieldOptimizationFieldType = {
  name: string;
  value: string;
  uuid: string;
};
export type FormDataDynamicFieldOptimizationFieldErrorsType = {
  name?: string;
  value?: string;
  uuid?: string;
};

export type FormDataDynamicFieldOptimizationType = {
  maxRuns: number;
  minSteps: number;
  maxSteps: number;
  metricName: ReactSelectOption;
  metricObjective: {
    value: FormDataDynamicFieldOptimizationMetricObjective;
    label: string;
  };
  fields: FormDataDynamicFieldOptimizationFieldType[];
};
export type FormDataDynamicFieldOptimizationErrorsType = {
  maxRuns?: string;
  minSteps?: string;
  maxSteps?: string;
  metricName?: string;
  metricObjective?: string;
  fields?: FormDataDynamicFieldOptimizationFieldErrorsType[];
};

export type FormDataType = {
  experimentTitle: string;
  experimentType: ReactSelectOption;
  // ReactSelectOption | string => Used for react-select single item
  dynamicFields: {
    [ExperimentTypes.values]?: FormDataDynamicFieldValuesType;
    [ExperimentTypes.linspace]?: FormDataDynamicFieldLinspaceType;
    [ExperimentTypes.arange]?: FormDataDynamicFieldArangeType;
    [ExperimentTypes.monteCarlo]?: FormDataDynamicFieldMonteCarloType;
    [ExperimentTypes.group]?: FormDataDynamicFieldGroupType;
    [ExperimentTypes.multiparameter]?: FormDataDynamicFieldMultiparameterType;
    [ExperimentTypes.optimization]?: FormDataDynamicFieldOptimizationType;
  };
};

export type RawExperimentOptimizationFieldValue =
  | { range: string }
  | { values: (string | number)[] };

export type RawExperimentOptimizationField = {
  name: string;
} & RawExperimentOptimizationFieldValue;

export type RawExperimentOptimizationType = Omit<
  FormDataDynamicFieldOptimizationType,
  "metricName" | "metricObjective" | "fields"
> & {
  metricName: string;
  metricObjective: string;
  fields: RawExperimentOptimizationField[];
};

/**
 * This is far too trusting of the incoming data – as its a JSON blob, the whole
 * thing should essentially be of an "unknown" type
 *
 * @todo fix this
 */
export type RawExperimentType = {
  experimentTitle: string;
  experimentType: string;
  dynamicFields: {
    values?: Omit<FormDataDynamicFieldValuesType, "field" | "values"> & {
      field: string;
      values: any[];
    };
    linspace?: Omit<FormDataDynamicFieldLinspaceType, "field"> & {
      field: string;
    };
    arange?: Omit<FormDataDynamicFieldArangeType, "field"> & { field: string };
    "monte-carlo"?: Omit<
      FormDataDynamicFieldMonteCarloType,
      "field" | "distribution"
    > & { field: string; distribution: string };
    group?: Omit<FormDataDynamicFieldGroupType, "runs"> & { runs: string[] };
    multiparameter?: Omit<FormDataDynamicFieldMultiparameterType, "runs"> & {
      runs: string[];
    };
    optimization?: RawExperimentOptimizationType;
  };
};

export type DynamicFieldsErrorsType = {
  [ExperimentTypes.values]?: FormDataDynamicFieldValuesErrorsType;
  [ExperimentTypes.linspace]?: FormDataDynamicFieldLinspaceErrorsType;
  [ExperimentTypes.arange]?: FormDataDynamicFieldArangeErrorsType;
  [ExperimentTypes.monteCarlo]?: FormDataDynamicFieldMonteCarloErrorsType;
  [ExperimentTypes.group]?: FormDataDynamicFieldGroupErrorsType;
  [ExperimentTypes.multiparameter]?: FormDataDynamicFieldMultiparameterErrorsType;
  [ExperimentTypes.optimization]?: FormDataDynamicFieldOptimizationErrorsType;
};

export type FormErrorsType = {
  experimentTitle?: string;
  dynamicFields?: DynamicFieldsErrorsType;
};

export type AllFormDataTypeDynamicFieldsType = Required<
  FormDataType["dynamicFields"]
>[keyof FormDataType["dynamicFields"]];

export type ParseError = {
  msg?: string;
};

export type ParseResult<T> = Result<T, ParseError>;
