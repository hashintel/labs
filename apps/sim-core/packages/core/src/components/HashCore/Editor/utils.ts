import { AnalysisJson } from "../../../features/analysis/analysisJsonTypes";
import { HcFile } from "../../../features/files/types";
import { HcFileKind } from "../../../features/files/enums";
import type { UserAlert } from "../../../features/viewer/types";
import { globalsFileId } from "../../../features/files/utils";
import { validateAnalysisJson } from "./../../../features/analysis/analysisJsonValidation";

export const fileActionSize = 18;

/**
 * @todo this should be a selector
 */
export const getDocsSection = (
  file?: HcFile,
  behaviorKeysOpen?: boolean
): string => {
  if (behaviorKeysOpen) {
    return "behaviors/behavior-keys";
  }

  if (file?.kind === HcFileKind.Dataset) {
    return "datasets";
  }

  switch (file?.id) {
    case "analysis":
      return "views/analysis";
    case globalsFileId:
      return "configuration";
    case "experiments":
      return "experiments";
    case "initialState":
      return "anatomy-of-an-agent/state";

    default:
      return "";
  }
};

export const validateAnalysisJsonAndDispatchErrorsIfAny = (
  analysis: AnalysisJson,
  viewerActions: {
    addUserAlert: (alert: UserAlert) => void;
    clearUserAlerts: () => void;
  },
) => {
  const result = validateAnalysisJson(analysis);
  viewerActions.clearUserAlerts();

  if (
    result.success &&
    result.warnings.length === 0 &&
    result.errors.length === 0
  ) {
    // TODO: Add a success notification. This has the prerequisite of renaming the `completed` notification type
    // to `success` and ensuring it does not break the simulation worker.
    return true;
  }
  const alerts: any[] = [];
  result.warnings.forEach((warning) =>
    alerts.push({
      type: "warning",
      message: `${warning.message} (Code: ${warning.name})`,
    })
  );
  result.errors.forEach((error) =>
    alerts.push({
      type: "error",
      message: `${error.message} (Error code: ${error.name})`,
    })
  );
  const baseAttrs = {
    context: "analysis.json",
    simulationId: "",
    timestamp: Date.now(),
    hideLinksToDocs: true,
  };
  alerts.forEach((alert) =>
    viewerActions.addUserAlert({ ...alert, ...baseAttrs }),
  );
};
