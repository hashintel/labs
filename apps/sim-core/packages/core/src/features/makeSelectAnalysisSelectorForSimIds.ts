import { createSelector } from "@reduxjs/toolkit";

import { selectAllSimulationData } from "./simulator/simulate/selectors";
import { selectAnalysis } from "./files/selectors";

/**
 * @todo choose a more permanent location for this that doesn't result in
 *       circular deps
 * @todo the read only part of this should be a scope
 */
export const makeSelectAnalysisSelectorForSimIds = (simIds: string[]) =>
  createSelector(selectAnalysis, (analysisSrc) =>
    createSelector(selectAllSimulationData, (data) => {
      const analysisSrcSet = new Set<string>(
        simIds
          .map((id) => data[id]?.analysis?.manifest)
          .filter(
            <T>(manifest: T | null | undefined): manifest is T => !!manifest,
          ),
      );

      switch (analysisSrcSet.size) {
        case 0:
          return { analysis: analysisSrc, readonly: false };

        case 1:
          return {
            analysis: analysisSrcSet.values().next().value as
              | string
              | undefined,
            readonly: true,
          };

        default:
          throw new Error("Cannot collate analysis with different manifests");
      }
    }),
  );
