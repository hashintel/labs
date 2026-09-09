import { TabKind } from "../../features/viewer/enums";

export const steps = () => import("../StepExplorer/StepExplorer");

export const agentScene = () => import("../AgentScene/AgentScene");

export const analysis = () => import("../Analysis/AnalysisViewer");

export const geo = () => import("../GeospatialMap/GeospatialMap");

export const lazyTabs: Partial<Record<TabKind, () => Promise<any>>> = {
  [TabKind.ThreeD]: agentScene,
  [TabKind.Analysis]: analysis,
  [TabKind.Geospatial]: geo,
  [TabKind.StepExplorer]: steps,
};
