import React, { FC } from "react";

import { PlotViewerPlots } from "./PlotViewerPlots";
import { PlotViewerProps } from "./types";
import { selectAnalysisMode } from "../../features/simulator/simulate/selectors";
import { useSimulatorSelector } from "../../features/simulator/context";

import "./PlotViewer.scss";

export const PlotViewer: FC<PlotViewerProps> = ({
  currentStep,
  outputs,
  onPlotsModalDelete,
  onPlotsModalSave,
  readonly,
}) => {
  const analysisMode = useSimulatorSelector(selectAnalysisMode);

  if (!analysisMode) {
    return (
      <div className="PlotViewer__Choose">
        <p>Choose an item from the activity sidebar to analyze</p>
      </div>
    );
  }

  return (
    <PlotViewerPlots
      currentStep={currentStep}
      analysisMode={analysisMode}
      outputs={outputs}
      onPlotsModalDelete={onPlotsModalDelete}
      onPlotsModalSave={onPlotsModalSave}
      readonly={readonly}
    />
  );
};
