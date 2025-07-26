import type { PlotData } from "plotly.js";

import { AgentState, Analysis, Json } from "../../";

export type DatumKeys = "x" | "y" | "z";
export type OutputSlice = { name: string; slice: [number] | [number, number] };
export function isOutputSlice<K extends DatumKeys>(
  d: HashDatum<K>,
): d is OutputSlice {
  return Object.prototype.hasOwnProperty.call(d, "name");
}
export type HashDatum<K extends DatumKeys> = PlotData[K] | string | OutputSlice;

export type HashPlotData = Partial<
  Omit<PlotData, DatumKeys> & {
    x: HashDatum<"x">;
    y: HashDatum<"y">;
    z: HashDatum<"z">;
  }
>;

export type PlotDefinition = {
  title: string;
  timeseries?: string[];
  scatter?: string[];
  scatter3d?: string[];
  layout?: Partial<
    Plotly.Layout & { hideCollatedLegend?: boolean; hideLegend?: boolean }
  >;
  config?: Partial<Plotly.Config>;
  position?: PlotPosition;
  type?: PlotData["type"];
  data?: HashPlotData[];
  hideStep?: boolean;
};

export type PlotPosition = {
  x: number | string;
  y: number | string;
};
