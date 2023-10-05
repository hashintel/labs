/**
 * This represents the typing of analysis.json.
 *
 * Further validation beyond typing is required to ensure that
 * the right metrics are paired with the right charts -
 * This is implemented in the file analysisJsonValidation.ts
 *
 * Notes:
 * - some plots will require an array, or single data point, as an output.
 * - Some experiment charts (e.g. stacked bar) can be generated automatically
 * for the user and do not need to be defined in analysis.json.
 */

// -------------------- OUTPUTS ------------------------ //

// Aggregates an array of values from a single step into a single value by some operation.
// Must be preceded by an operation producing an array of values.

export enum AggregatorOperator {
  "max" = "max",
  "min" = "min",
  "mean" = "mean",
  "sum" = "sum",
}
export enum CountOperator {
  "count" = "count",
}

export type SingleStepAggregationOperation = {
  op: CountOperator | AggregatorOperator;
};

// 2. Gets the max/min/mean/sum of a value across ALL steps in a simulation
// QUESTION: up to the current step shown, or just across all steps?
// Must be proceeded by an operation producing a single value.
//
// Immediately useful for experiment plots -
// - e.g. producing a z value to chart against x and y parameters being varied.
// Could also be expanded to add a 'range: number` or 'steps: number' field
// to produce things like a 7 step moving average.
export enum CumulativeAggregateOperator {
  "aggregate" = "aggregate",
}

export type CumulativeAggregationOperation = {
  op: CumulativeAggregateOperator.aggregate;
  by: AggregatorOperator;
  range?: number; // <-- if supplied, aggregates across the previous n steps only
};

// both of these will distill an array of numbers to a single number
export type AggregationOperation =
  | SingleStepAggregationOperation
  | CumulativeAggregationOperation;

export enum FilterComparator {
  "eq" = "eq",
  "neq" = "neq",
  "lt" = "lt",
  "lte" = "lte",
  "gt" = "gt",
  "gte" = "gte",
}
export enum FilterOperator {
  "filter" = "filter",
}
export type FilterOperation = {
  op: FilterOperator.filter;
  field: string | number; // TODO: why is this a number?
  comparison: FilterComparator;
  value: string | number | boolean | null;
};

export enum GetOperator {
  "get" = "get",
}

export type GetOperation = {
  op: "get";
  field: string | number; // might be an array index
};

export type OutputOperation =
  | AggregationOperation
  | FilterOperation
  | GetOperation;

export type Output = { [title: string]: OutputOperation[] };

// --------------------- PLOTS ------------------------- //

export type XDataPoint = {
  x: string;
  name?: string;
};

export type XDataPoints = {
  x: string[];
  name?: string[];
};

export type YDataPoint = {
  y: string;
  name?: string;
};

export type YDataPoints = {
  y: string[];
  name?: string[];
};

export type YAndXDataPoints = YDataPoints & XDataPoints;

export type YPointAndOptionalXPoint = (XDataPoint | YDataPoint) | YDataPoints;

export type ZDataPoints = {
  z: string;
};

// TODO: Force this to be an array, because a single bar bar chart is not very interesting.
export type BarChart = {
  type: "bar";
  data: YDataPoint | YDataPoint[];
};

export type BoxPlot = {
  type: "box";
  data: YDataPoint | YDataPoint[];
};

export type Histogram = {
  type: "histogram";
  data: XDataPoint | XDataPoint[] | YDataPoint | YDataPoint[];
};

export type Timeseries = {
  type: "timeseries";
  data: YDataPoint[];
};

// Selection of charts which can be used to map an output z of interest
// against parameters x and y varied in an experiment.
// Could end in either a CumulativeAggregationOperation -
// - in which case the chart is the same across all steps, as it aggregates the values across all steps computed, and z will always be the same.
// or an SingleStepAggregationOperation
// - in which case the chart updates per step with the different value of z.
// The former is probably more useful.
export type TwoParameterExperimentChart = {
  type: "contour" | "heatmap" | "line3d" | "scatter3d";
  data: ZDataPoints[];
  // z: string; // must refer to an output that ends in an AggregationOperation
  // DataSource not needed as it cannot be timeseries (?)
};

export type LineOrScatterDataType = YPointAndOptionalXPoint[];

export type Line = {
  type: "line";
  data: LineOrScatterDataType[];
};

export type Scatter = {
  type: "scatter";
  data: LineOrScatterDataType[];
};

export type Chart =
  | BarChart
  | BoxPlot
  | Histogram
  | Timeseries
  | Line
  | Scatter;
// | TwoParameterExperimentChart;

export type TimeseriesShortcut = {
  timeseries?: string[];
};

// this could be a generic: Plot<Line>.
export type Plot = {
  title: string;
  layout?: {
    // assume 50%h x 100%w if not provided?
    height: string;
    width: string;
  };
  position?: {
    // define for user if not provided?
    x: string;
    y: string;
  };
} & (Chart | TimeseriesShortcut);

/**
 * @todo this should just be ParsedAnalysis (which is just Json) – we're assuming
 *       too much about it
 */
export type UncheckedAnalysisJson = {
  outputs: Partial<Output>;
  plots: Partial<Plot[]>;
};

export type AnalysisJson = { outputs: Output; plots: Plot[] };
