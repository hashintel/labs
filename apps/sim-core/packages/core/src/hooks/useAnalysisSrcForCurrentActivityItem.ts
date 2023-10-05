import { useSelector } from "react-redux";

import { makeSelectAnalysisSelectorForSimIds } from "../features/makeSelectAnalysisSelectorForSimIds";
import { selectSimulationIdsForAnalysisMode } from "../features/simulator/simulate/selectors";
import { useSimulatorSelector } from "../features/simulator/context";

/**
 * makeSelectAnalysisForSimIds depends on state from both stores, so it its
 * a selector wrapper in another selector. This hook unwraps that for you
 */
export const useAnalysisSrcForCurrentActivityItem = () => {
  const simIds = useSimulatorSelector(selectSimulationIdsForAnalysisMode);
  const analysisSelector = makeSelectAnalysisSelectorForSimIds(simIds);
  const simulatorSelector = useSelector(analysisSelector);

  return useSimulatorSelector(simulatorSelector);
};
