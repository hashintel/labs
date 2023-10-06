import React, { FC, lazy } from "react";

import { AnalysisProps } from "../Analysis/types";
import { SimulationViewerLazyTab } from "./LazyTab/SimulationViewerLazyTab";
import { analysis } from "./lazy";

const AnalysisViewerLazy = lazy(() =>
  analysis().then((module) => ({
    default: module.AnalysisViewer,
  }))
);

export const AnalysisViewer: FC<AnalysisProps & { visible: boolean }> = ({
  visible,
  ...props
}) => (
  <SimulationViewerLazyTab visible={visible}>
    <AnalysisViewerLazy {...props} />
  </SimulationViewerLazyTab>
);
