import { PlotParams } from "react-plotly.js";

export interface PlotViewerProps {
  currentStep: number;
  outputs: Record<string, any[]>;
  onPlotsModalSave: Function;
  onPlotsModalDelete: Function;
  readonly: boolean;
}

export type OutputPlotProps = PlotParams & {
  key: string;
  style: any;
  definition: any;
  hideCollatedLegend?: boolean;
  hideStep?: boolean;
  outputs?: Record<string, any[]>;
};
