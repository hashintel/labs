import { PlotParams } from "react-plotly.js";

export type PlotViewerProps = {
  currentStep: number;
  outputs: { [index: string]: any[] };
  onPlotsModalSave: Function;
  onPlotsModalDelete: Function;
  readonly: boolean;
};

export type OutputPlotProps = PlotParams & {
  key: string;
  style: any;
  definition: any;
  hideCollatedLegend?: boolean;
  hideStep?: boolean;
  outputs?: { [index: string]: any[] };
};
