import React, { FC, lazy } from "react";

import type { SimulationStepProps } from "../AgentScene/AgentScene";
import { SimulationViewerLazyTab } from "./LazyTab/SimulationViewerLazyTab";
import { agentScene } from "./lazy";

const AgentSceneLazy = lazy(() =>
  agentScene().then((module) => ({
    default: module.AgentScene,
  })),
);

export const AgentScene: FC<SimulationStepProps> = (props) => (
  <SimulationViewerLazyTab visible={props.visible}>
    <AgentSceneLazy {...props} />
  </SimulationViewerLazyTab>
);
