import { TabKind } from "../../features/viewer/enums";

export const steps = () =>
  import(/* webpackChunkName: "StepExplorer" */ "../StepExplorer/StepExplorer");

export const agentScene = () =>
  import(/* webpackChunkName: "AgentScene" */ "../AgentScene/AgentScene");

export const analysis = () =>
  import(/* webpackChunkName: "AnalysisViewer" */ "../Analysis/AnalysisViewer");

export const geo = () =>
  import(/* webpackChunkName: "Geospatial" */ "../GeospatialMap/GeospatialMap");

export const lazyTabs: Partial<Record<TabKind, () => Promise<any>>> = {
  [TabKind.ThreeD]: agentScene,
  [TabKind.Analysis]: analysis,
  [TabKind.Geospatial]: geo,
  [TabKind.StepExplorer]: steps,
};
