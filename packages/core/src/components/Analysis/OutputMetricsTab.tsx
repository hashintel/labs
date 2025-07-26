import React, { FC } from "react";

import { AnalysisViewerOutputMetricsTabProps } from "./types";
import { ButtonCallToAction } from "./ButtonCallToAction";
import { HelpParagraph } from "./HelpParagraph";
import { IconAddDatapoint } from "../Icon/AddDatapoint";
import { OutputMetricsGrid } from "./OutputMetricsGrid";

export const OutputMetricsTab: FC<AnalysisViewerOutputMetricsTabProps> = ({
  analysisOutputMetricsDataAvailable,
  showOutputMetricsModal,
  analysis,
  onOutputMetricsModalSaveHandler,
  onOutputMetricsModalDeleteHandler,
  onDuplicateMetricHandler,
  readonly,
}) =>
  !analysisOutputMetricsDataAvailable ? (
    <div className="AnalysisViewer__NoData">
      <div style={{ flex: 1 }} />
      <b>No output metrics have been defined</b>
      {readonly ? null : (
        <>
          <p>
            You’ll need to define one or more output metrics in order to create
            a plot
          </p>
          <ButtonCallToAction onClick={showOutputMetricsModal}>
            <IconAddDatapoint size={64} />
            <div>
              <strong>Define new metric</strong>
              <span>Define your first metric</span>
            </div>
          </ButtonCallToAction>
        </>
      )}
      <div style={{ flex: 1 }} />
      <HelpParagraph text="Questions about metrics?" />
    </div>
  ) : (
    <>
      <OutputMetricsGrid
        metrics={analysis.outputs}
        onOutputMetricsModalSave={onOutputMetricsModalSaveHandler}
        onOutputMetricsModalDelete={onOutputMetricsModalDeleteHandler}
        onDuplicateMetric={onDuplicateMetricHandler}
        readonly={readonly}
      />
      <HelpParagraph text="Questions about metrics?" />
    </>
  );
