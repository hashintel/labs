import React, { FC, lazy } from "react";

import type { GeospatialMapProps } from "../GeospatialMap/GeospatialMap";
import { SimulationViewerLazyTab } from "./LazyTab/SimulationViewerLazyTab";
import { geo } from "./lazy";

const GeospatialMapLazy = lazy(() =>
  geo().then((module) => ({
    default: module.GeospatialMap,
  })),
);

export const GeospatialMap: FC<GeospatialMapProps & { visible: boolean }> = ({
  visible,
  ...props
}) => (
  <SimulationViewerLazyTab visible={visible}>
    <GeospatialMapLazy {...props} />
  </SimulationViewerLazyTab>
);
