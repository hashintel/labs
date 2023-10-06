import React, { FC } from "react";
import { useSelector } from "react-redux";

import { AnalysisViewerPlotsTabProps } from "./types";
import { ButtonCallToAction } from "./ButtonCallToAction";
import { HelpParagraph } from "./HelpParagraph";
import { IconCreatePlot } from "../Icon/CreatePlot";
import { PlotViewer } from "../PlotViewer/PlotViewer";
import { Scope, useScopes } from "../../features/scopes";
import { selectEmbedded } from "../../features/viewer/selectors";

export const PlotsTab: FC<AnalysisViewerPlotsTabProps> = ({
  analysisPlotsDataAvailable,
  currentStep,
  outputs,
  onPlotsModalSaveHandler,
  onPlotsModalDeleteHandler,
  analysisOutputMetricsDataAvailable,
  showPlotsModal,
  analysisMode,
  readonly,
}) => {
  const { canEdit, canLogin } = useScopes(Scope.edit, Scope.login);
  const embedded = useSelector(selectEmbedded);

  if (!analysisMode) {
    return embedded ? null : (
      <div className="AnalysisViewer__CenteredDiv">
        <p>Choose an item from the activity sidebar to analyze</p>
      </div>
    );
  }
  return analysisPlotsDataAvailable ? (
    <PlotViewer
      currentStep={currentStep}
      outputs={outputs}
      onPlotsModalSave={onPlotsModalSaveHandler}
      onPlotsModalDelete={onPlotsModalDeleteHandler}
      readonly={readonly}
    />
  ) : (
    <div className="AnalysisViewer__NoData">
      <div style={{ flex: 1 }} />
      <b>You haven't yet created any plots</b>
      {!canLogin && !canEdit ? null : !analysisOutputMetricsDataAvailable ? (
        <p>
          You’ll need to {!canEdit && "sign in and "}
          define at least one output metric to create a plot
        </p>
      ) : (
        <>
          <p>Click below to create your first visualisation</p>
          <ButtonCallToAction onClick={showPlotsModal}>
            <IconCreatePlot size={64} />
            <div>
              <strong>Create new plot</strong>
              <span>Add your first plot</span>
            </div>
          </ButtonCallToAction>
        </>
      )}
      <div style={{ flex: 1 }} />
      <HelpParagraph text="Questions about plots?" />
    </div>
  );
};
