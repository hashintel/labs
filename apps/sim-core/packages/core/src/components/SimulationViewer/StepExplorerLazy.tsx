import React, { FC, lazy } from "react";

import { SimulationViewerLazyTab } from "./LazyTab/SimulationViewerLazyTab";
import type { StepExplorerProps } from "../StepExplorer/StepExplorer";
import { steps } from "./lazy";

const StepExplorerLazy = lazy(() =>
  steps().then((module) => ({
    default: module.StepExplorer,
  }))
);

export const StepExplorer: FC<StepExplorerProps> = (props) => (
  <SimulationViewerLazyTab visible={props.visible}>
    <StepExplorerLazy {...props} />
  </SimulationViewerLazyTab>
);
