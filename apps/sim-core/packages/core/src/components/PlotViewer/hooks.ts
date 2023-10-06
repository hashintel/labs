import { useMemo } from "react";
import { createSelector } from "@reduxjs/toolkit";

import { PlotDataItem } from "./analyze";
import {
  selectAllSimulationData,
  selectSimulationIdsForAnalysisMode,
} from "../../features/simulator/simulate/selectors";
import { useSimulatorSelector } from "../../features/simulator/context";

const makeSelectPlots = (simIds: string[]) =>
  createSelector(selectAllSimulationData, (data) => {
    const plots = simIds
      .map(
        (simId) =>
          [simId, Object.values(data[simId].plots?.plots ?? {})] as const
      )
      .filter(([_, plots]) => plots?.length);

    return plots.length === simIds.length ? Object.fromEntries(plots) : {};
  });

export const usePlots = (): Record<string, PlotDataItem[] | null> => {
  const simIds = useSimulatorSelector(selectSimulationIdsForAnalysisMode);
  const joinedSimIds = simIds.join(",");
  const selector = useMemo(() => makeSelectPlots(simIds), [joinedSimIds]);

  return useSimulatorSelector(selector);
};
