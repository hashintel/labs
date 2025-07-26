import { MouseEvent } from "react";
import { PlotParams } from "react-plotly.js";

import { AnalysisMode } from "../../features/simulator/simulate/enum";
import { ReactSelectOption } from "../Dropdown/types";

export interface AnalysisProps {
  currentStep: number;
  visible?: boolean;
}

export interface AnalysisViewerPlotsTabProps {
  analysisPlotsDataAvailable: boolean;
  analysisOutputMetricsDataAvailable: boolean;
  currentStep: number;
  outputs: Record<string, any[]>;
  analysisMode?: AnalysisMode | null;
  onPlotsModalSaveHandler: Function;
  onPlotsModalDeleteHandler: Function;
  showPlotsModal: (event: MouseEvent) => void;
  readonly: boolean;
}

export interface AnalysisViewerOutputMetricsTabProps {
  analysisOutputMetricsDataAvailable: boolean;
  showOutputMetricsModal: (event: MouseEvent) => void;
  analysis: any;
  onOutputMetricsModalSaveHandler: Function;
  onOutputMetricsModalDeleteHandler: Function;
  onDuplicateMetricHandler: Function;
  readonly: boolean;
}

export type OutputPlotProps = PlotParams & {
  key: string;
  style: any;
  hideStep?: boolean;
};

export enum ButtonCallToActionType {
  METRICS = "METRICS",
  PLOTS = "PLOTS",
}

export interface ButtonCallToActionProps {
  children: JSX.Element | JSX.Element[];
  onClick?: (event: MouseEvent) => void;
}

export interface AnalysisViewerActionButtonsProps {
  canCreateNewPlot?: boolean;
  showOutputMetricsModal: (event: MouseEvent) => void;
  showPlotsModal: (event: MouseEvent) => void;

  /**
   * This has to be true, as AnalysisViewerActionButtons cannot render without
   * it
   */
  canEdit: true;
}

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

export interface OperationItemProps {
  operation: Operation;
  index: number;
  onDelete: (event: MouseEvent) => void;
  onChange: Function;
  permittedOperations: ReactSelectOption[]; // the operations that preceed this one.
  hideDelete?: boolean;
  behaviorKeysOptions?: ReactSelectOption[]; // used for "field"
}

export interface Operation {
  op: OperationTypes;
  field?: string;
  comparison?: ComparisonTypes;
  value?: any;
}

export interface OutputMetricsGridProps {
  onOutputMetricsModalSave: Function;
  metrics?: Record<string, Operation[]>;
  onOutputMetricsModalDelete?: Function;
  onDuplicateMetric?: Function;
  sizeClassname?: string;
  readonly: boolean;
}

interface PlotLayout {
  width: string;
  height: string;
}

interface PlotPosition {
  x: string;
  y: string;
}

enum PlotType {
  timeseries,
  histogram,
  barplot,
  line,
}

interface PlotData {
  y: string;
  name: string;
}

export interface Plot {
  title: string;
  layout: PlotLayout;
  position: PlotPosition;
  type?: PlotType;
  data?: PlotData[];
  timeseries?: string[];
}

export interface AnalysisObject {
  outputs: Record<string, Operation[]>;
  plots: Plot[];
}

export interface AnalysisState {
  lastAnalysisString?: any;
  analysis?: AnalysisObject;
  error: any;
}

export interface OnOutputMetricsModalSaveType {
  title: string;
  operations: Operation[];
}

export interface OnOutputMetricsModalSaveProps {
  data: OnOutputMetricsModalSaveType;
}

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

interface AxisItemType {
  name: string;
  metric: string;
}
export type YAxisItemType = AxisItemType;
export type XAxisItemType = AxisItemType;

export interface YAxisItemProps {
  item: YAxisItemType;
  index: number;
  metricKeysOptions: ReactSelectOption[];
  onDelete: (event: MouseEvent) => void;
  onChange: Function;
  hideDelete: boolean;
}
