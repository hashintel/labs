import { makeSelectAnalysisSelectorForSimIds } from "../features/makeSelectAnalysisSelectorForSimIds";
import { selectSimulationIdsForAnalysisMode } from "../features/simulator/simulate/selectors";
import { useFilesSelector } from "../features/files/FilesContext";
import { useSimulatorSelector } from "../features/simulator/context";

/**
 * makeSelectAnalysisForSimIds depends on state from both stores, so it wraps
 * a selector in another selector. This hook unwraps that for you.
 */
export const useAnalysisSrcForCurrentActivityItem = () => {
  const simIds = useSimulatorSelector(selectSimulationIdsForAnalysisMode);
  const analysisSelector = makeSelectAnalysisSelectorForSimIds(simIds);
  const simulatorSelector = useFilesSelector(analysisSelector);

  return useSimulatorSelector(simulatorSelector);
};
