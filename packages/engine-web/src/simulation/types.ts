import { AgentState } from "../glue";

export type OutputValue = number | number[];
export type Outputs = { [key: string]: OutputValue };
export type OutputSeriesValue = null | OutputValue;

export type OutputSeries = {
  [key: string]: OutputSeriesValue[];
};

export type OutputDefinition = {
  name: string;
  fn: OutputFn;
};

export type OutputFn = (state: AgentState[], series: OutputSeries) => any;
