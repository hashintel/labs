import { TabKind } from "./enums";
import { ViewerTab } from "./types";

export const viewerTabs: ViewerTab[] = [
  {
    kind: TabKind.ThreeD,
    name: "3D Viewer",
  },
  {
    kind: TabKind.Geospatial,
    name: "Geospatial",
  },
  {
    kind: TabKind.Analysis,
    name: "Analysis",
  },
  {
    kind: TabKind.ProcessChart,
    name: "Process Chart",
  },
  {
    kind: TabKind.RawOutput,
    name: "Raw Output",
  },
  {
    kind: TabKind.StepExplorer,
    name: "Step Explorer",
  },
];

export const embeddableTabs = [
  TabKind.ThreeD,
  TabKind.Geospatial,
  TabKind.Analysis,
  TabKind.ProcessChart,
];
