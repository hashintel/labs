import { MouseEvent } from "react";
import { PlotParams } from "react-plotly.js";

import { AnalysisMode } from "../../features/simulator/simulate/enum";
import { ReactSelectOption } from "../Dropdown/types";

export type AnalysisProps = {
  currentStep: number;
  visible?: boolean;
};

export type AnalysisViewerPlotsTabProps = {
  analysisPlotsDataAvailable: boolean;
  analysisOutputMetricsDataAvailable: boolean;
  currentStep: number;
  outputs: { [index: string]: any[] };
  analysisMode?: AnalysisMode | null;
  onPlotsModalSaveHandler: Function;
  onPlotsModalDeleteHandler: Function;
  showPlotsModal: (event: MouseEvent) => void;
  readonly: boolean;
};

export type AnalysisViewerOutputMetricsTabProps = {
  analysisOutputMetricsDataAvailable: boolean;
  showOutputMetricsModal: (event: MouseEvent) => void;
  analysis: any;
  onOutputMetricsModalSaveHandler: Function;
  onOutputMetricsModalDeleteHandler: Function;
  onDuplicateMetricHandler: Function;
  readonly: boolean;
};

export type OutputPlotProps = PlotParams & {
  key: string;
  style: any;
  hideStep?: boolean;
};

export enum ButtonCallToActionType {
  METRICS = "METRICS",
  PLOTS = "PLOTS",
}

export type ButtonCallToActionProps = {
  children: JSX.Element | JSX.Element[];
  onClick?: (event: MouseEvent) => void;
};

export type AnalysisViewerActionButtonsProps = {
  canCreateNewPlot?: boolean;
  showOutputMetricsModal: (event: MouseEvent) => void;
  showPlotsModal: (event: MouseEvent) => void;

  /**
   * This has to be true, as AnalysisViewerActionButtons cannot render without
   * it
   */
  canEdit: true;
};

export enum ComparisonTypes {
  eq = "eq",
  neq = "neq",
  lt = "lt",
  lte = "lte",
  gt = "gt",
  gte = "gte",
}

export enum OperationTypes {
  filter = "filter",
  count = "count",
  get = "get",
  sum = "sum",
  min = "min",
  max = "max",
  mean = "mean",
}

export type OperationItemProps = {
  operation: Operation;
  index: number;
  onDelete: (event: MouseEvent) => void;
  onChange: Function;
  permittedOperations: ReactSelectOption[]; // the operations that preceed this one.
  hideDelete?: boolean;
  behaviorKeysOptions?: ReactSelectOption[]; // used for "field"
};

export type Operation = {
  op: OperationTypes;
  field?: string;
  comparison?: ComparisonTypes;
  value?: any;
};

export type OutputMetricsGridProps = {
  onOutputMetricsModalSave: Function;
  metrics?: { [index: string]: Operation[] };
  onOutputMetricsModalDelete?: Function;
  onDuplicateMetric?: Function;
  sizeClassname?: string;
  readonly: boolean;
};

type PlotLayout = {
  width: string;
  height: string;
};

type PlotPosition = {
  x: string;
  y: string;
};

enum PlotType {
  timeseries,
  histogram,
  barplot,
  line,
}

type PlotData = {
  y: string;
  name: string;
};

export type Plot = {
  title: string;
  layout: PlotLayout;
  position: PlotPosition;
  type?: PlotType;
  data?: PlotData[];
  timeseries?: string[];
};

export type AnalysisObject = {
  outputs: { [index: string]: Operation[] };
  plots: Plot[];
};

export type AnalysisState = {
  lastAnalysisString?: any;
  analysis?: AnalysisObject;
  error: any;
};

export type OnOutputMetricsModalSaveType = {
  title: string;
  operations: Operation[];
};

export type OnOutputMetricsModalSaveProps = {
  data: OnOutputMetricsModalSaveType;
};

export enum ChartTypes {
  area = "area",
  bar = "bar",
  box = "box",
  heatmap = "heatmap",
  timeseries = "timeseries",
  histogram = "histogram",
  line = "line",
  scatter = "scatter",
  // Two parameter experiment
  // contour = "contour",
  // heatmap = "heatmap",
  // line3d = "line3d",
  // scatter3d = "scatter3d",
}

type AxisItemType = {
  name: string;
  metric: string;
};
export type YAxisItemType = AxisItemType;
export type XAxisItemType = AxisItemType;

export type YAxisItemProps = {
  item: YAxisItemType;
  index: number;
  metricKeysOptions: ReactSelectOption[];
  onDelete: (event: MouseEvent) => void;
  onChange: Function;
  hideDelete: boolean;
};
