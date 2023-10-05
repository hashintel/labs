import React, { FC } from "react";

import { AnalysisMode } from "../../features/simulator/simulate/enum";
import { PlotViewerCollatedExperiment } from "./PlotViewerCollatedExperiment";
import { PlotViewerProps } from "./types";
import { PlotViewerSingleRun } from "./PlotViewerSingleRun";
import {
  selectCurrentExperimentId,
  selectCurrentSimulationId,
} from "../../features/simulator/simulate/selectors";
import { useSimulatorSelector } from "../../features/simulator/context";

export const PlotViewerPlots: FC<
  PlotViewerProps & { analysisMode: AnalysisMode }
> = ({
  currentStep,
  analysisMode,
  outputs,
  onPlotsModalDelete,
  onPlotsModalSave,
  readonly,
}) => {
  const currentSimulationId = useSimulatorSelector(selectCurrentSimulationId);
  const currentExperimentId = useSimulatorSelector(selectCurrentExperimentId);

  switch (analysisMode) {
    case AnalysisMode.SingleRun:
      return (
        <PlotViewerSingleRun
          currentStep={currentStep}
          key={currentSimulationId}
          outputs={outputs}
          onPlotsModalDelete={onPlotsModalDelete}
          onPlotsModalSave={onPlotsModalSave}
          readonly={readonly}
        />
      );

    case AnalysisMode.ExperimentCollated:
      return (
        <PlotViewerCollatedExperiment
          currentStep={currentStep}
          key={currentExperimentId}
          outputs={outputs}
          onPlotsModalDelete={onPlotsModalDelete}
          onPlotsModalSave={onPlotsModalSave}
          readonly={readonly}
        />
      );

    // TODO: should this be a `default:` ?
    case null:
      throw new Error("Cannot show plots without selecting analysis mode");
  }
};
