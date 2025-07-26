import React, { FC, useCallback, useEffect, useState } from "react";
import { unstable_batchedUpdates } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import { Tab, TabList, TabPanel, Tabs } from "react-tabs";
import { useModal } from "react-modal-hook";
import classNames from "classnames";
import { sum } from "lodash";

import { AnalysisProps, Plot } from "./types";
import { AnalysisViewerActionButtons } from "./AnalysisViewerActionButtons";
import { HelpParagraph } from "./HelpParagraph";
import { ModalOutputMetrics } from "../Modal/Analysis/ModalOutputMetrics";
import { ModalPlots } from "../Modal/Analysis/ModalPlots";
import { OutputMetricsTab } from "./OutputMetricsTab";
import { PlotsTab } from "./PlotsTab";
import { Scope, useScope } from "../../features/scopes";
import { getHelpForSyntaxError } from "./utils";
import {
  onDuplicateMetric,
  onOutputMetricsModalDelete,
  onOutputMetricsModalSave,
  onPlotsModalDelete,
  onPlotsModalSave,
} from "./modals";
import { selectAnalysisMode } from "../../features/simulator/simulate/selectors";
import { selectEmbedded } from "../../features/viewer/selectors";
import { useAnalysisSrcForCurrentActivityItem } from "../../hooks/useAnalysisSrcForCurrentActivityItem";
import { useParseAnalysis } from "../../hooks/useParseAnalysis";
import { useResizeObserver } from "../../hooks/useResizeObserver/useResizeObserver";
import { useSimulatorSelector } from "../../features/simulator/context";

import "./AnalysisViewer.scss";

export const AnalysisViewer: FC<AnalysisProps> = ({ currentStep }) => {
  const dispatch = useDispatch();
  const analysisMode = useSimulatorSelector(selectAnalysisMode);
  const embedded = useSelector(selectEmbedded);
  const canEdit = useScope(Scope.edit);

  const { analysis: analysisString, readonly: analysisReadOnly } =
    useAnalysisSrcForCurrentActivityItem();
  const [analysisState, setAnalysis] = useParseAnalysis(analysisString);

  // @todo remove this any
  const { analysis, error }: any = analysisState;

  // TODO: discuss if we also need the useCancellableDebounce trick here

  const outputs = analysis?.outputs || {};
  const metricKeys = Object.keys(outputs);
  const analysisOutputMetricsDataAvailable = metricKeys.length > 0;
  const analysisPlotsDataAvailable = analysis?.plots?.length > 0;
  const combinedHeightOfAllPlots = !analysisPlotsDataAvailable
    ? 0
    : sum(
        analysis.plots.map((plot: Plot) =>
          parseInt(plot.layout?.height?.replace?.("%", "") ?? 0, 10),
        ),
      );

  // @todo collapse state
  const [_currentTab, setCurrentTab] = useState(1);
  const [hasTouchedCurrentTab, setHasTouchedCurrentTab] = useState(false);

  const currentTab = hasTouchedCurrentTab
    ? _currentTab
    : !embedded && analysisPlotsDataAvailable
      ? 1
      : 0;

  const onOutputMetricsModalSaveHandler = useCallback(
    (data: any, previousKey?: string) =>
      onOutputMetricsModalSave({
        dispatch,
        setAnalysis,
        analysisString,
        analysis,
        data,
        previousKey,
      }),
    [dispatch, setAnalysis, analysis, analysisString],
  );

  const onOutputMetricsModalDeleteHandler = (keyToDelete: string) =>
    onOutputMetricsModalDelete({
      dispatch,
      setAnalysis,
      analysisString,
      analysis,
      keyToDelete,
    });

  const onDuplicateMetricHandler = (metricKey: string) =>
    onDuplicateMetric({
      analysis,
      dispatch,
      setAnalysis,
      analysisString,
      metricKey,
    });

  const onPlotsModalSaveHandler = useCallback(
    (data, plotIndex) =>
      onPlotsModalSave({
        data,
        plotIndex,
        analysis,
        analysisString,
        dispatch,
        setAnalysis,
      }),
    [analysis, analysisString, dispatch],
  );

  const onPlotsModalDeleteHandler = (indexToDelete: number) =>
    onPlotsModalDelete({
      indexToDelete,
      dispatch,
      setAnalysis,
      analysisString,
      analysis,
    });

  const [showOutputMetricsModal, hideOutputMetricsModal] = useModal(
    () => (
      <ModalOutputMetrics
        onClose={hideOutputMetricsModal}
        onSave={onOutputMetricsModalSaveHandler}
        isCreate={true}
        existingMetricKeys={metricKeys}
      />
    ),
    [metricKeys, onOutputMetricsModalSaveHandler],
  );

  const [showPlotsModal, hidePlotsModal] = useModal(
    () => (
      <ModalPlots
        onClose={hidePlotsModal}
        onSave={onPlotsModalSaveHandler}
        isCreate={true}
        outputs={outputs}
        combinedHeightOfAllPlots={combinedHeightOfAllPlots}
      />
    ),
    [outputs, onPlotsModalSaveHandler, combinedHeightOfAllPlots],
  );

  const tabContainerWidthObserver = useResizeObserver(
    ({ width }) => {
      document.documentElement.style.setProperty(
        "--analysis-tab-container-width",
        `${Math.floor(width)}px`,
      );
    },
    { onObserve: null },
  );

  useEffect(() => {
    if (analysisOutputMetricsDataAvailable && currentTab === 0 && !embedded) {
      const viewerSecondaryPane = document.querySelector<HTMLDivElement>(
        ".HashCoreSection-splitter > .splitter-layout > .layout-pane:not(.layout-pane-primary)",
      );

      const analysisSecondaryPane =
        viewerSecondaryPane?.querySelector<HTMLDivElement>(
          ".HashCoreViewer > .splitter-layout > .layout-pane:not(.layout-pane-primary)",
        );

      viewerSecondaryPane?.classList.add("AnalysisViewerSplitterController");
      viewerSecondaryPane?.style.setProperty(
        "--avsc-analysis-width",
        `${analysisSecondaryPane?.getBoundingClientRect().width ?? 0}px`,
      );

      return () => {
        viewerSecondaryPane?.classList.remove(
          "AnalysisViewerSplitterController",
        );
        viewerSecondaryPane?.style.removeProperty("--avsc-analysis-width");
      };
    }
  }, [analysisOutputMetricsDataAvailable, currentTab, embedded]);

  if (!analysis) {
    return (
      <div className="AnalysisViewer__CenteredDiv">
        <span>
          <strong>Error</strong>
        </span>
        <span>We could not parse the contents of analysis.json</span>
        {error && (
          <pre className="AnalysisViewer__CenteredDiv__Pre">
            {getHelpForSyntaxError(error, analysisString)}
          </pre>
        )}
        <HelpParagraph text="Need help?" />
      </div>
    );
  }

  const plotsTab = (
    <PlotsTab
      analysisOutputMetricsDataAvailable={analysisOutputMetricsDataAvailable}
      analysisPlotsDataAvailable={analysisPlotsDataAvailable}
      analysisMode={analysisMode}
      currentStep={currentStep}
      onPlotsModalDeleteHandler={onPlotsModalDeleteHandler}
      onPlotsModalSaveHandler={onPlotsModalSaveHandler}
      outputs={outputs}
      showPlotsModal={showPlotsModal}
      readonly={analysisReadOnly || !canEdit}
    />
  );

  if (!canEdit) {
    return (
      <div className="AnalysisViewer__Container">
        <div className="react-tabs AnalysisViewer__Tabs">
          <div
            className={classNames({
              AnalysisViewer__TabPanel: true,
              "react-tabs__tab-panel--selected": true,
              AnalysisViewer__LoggedOut: true,
              "AnalysisViewer__TabPanel__Plots--nodata":
                !analysisPlotsDataAvailable,
            })}
          >
            {plotsTab}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="AnalysisViewer__Container">
      <Tabs
        className="react-tabs AnalysisViewer__Tabs"
        selectedIndex={currentTab}
        onSelect={(tabIndex) => {
          unstable_batchedUpdates(() => {
            setHasTouchedCurrentTab(true);
            setCurrentTab(tabIndex);
          });
        }}
      >
        <div
          className="AnalysisViewer__TabContainer"
          ref={tabContainerWidthObserver}
        >
          <TabList className="react-tabs__tab-list AnalysisViewer__TabContainer__TabList">
            <Tab className="react-tabs__tab AnalysisViewer__TabContainer__Tab">
              Metrics
            </Tab>
            <Tab className="react-tabs__tab AnalysisViewer__TabContainer__Tab">
              Plots
            </Tab>
          </TabList>
          {analysisReadOnly ? null : (
            <AnalysisViewerActionButtons
              canCreateNewPlot={analysisOutputMetricsDataAvailable}
              showOutputMetricsModal={showOutputMetricsModal}
              showPlotsModal={showPlotsModal}
              canEdit={canEdit}
            />
          )}
        </div>
        <TabPanel
          className={classNames({
            AnalysisViewer__TabPanel: true,
            "AnalysisViewer__TabPanel--nodata":
              !analysisOutputMetricsDataAvailable,
          })}
        >
          <OutputMetricsTab
            analysisOutputMetricsDataAvailable={
              analysisOutputMetricsDataAvailable
            }
            showOutputMetricsModal={showOutputMetricsModal}
            analysis={analysis}
            onOutputMetricsModalSaveHandler={onOutputMetricsModalSaveHandler}
            onOutputMetricsModalDeleteHandler={
              onOutputMetricsModalDeleteHandler
            }
            onDuplicateMetricHandler={onDuplicateMetricHandler}
            readonly={analysisReadOnly}
          />
        </TabPanel>
        <TabPanel
          className={classNames({
            AnalysisViewer__TabPanel: true,
            "AnalysisViewer__TabPanel--nodata": !analysisPlotsDataAvailable,
          })}
        >
          {plotsTab}
        </TabPanel>
      </Tabs>
    </div>
  );
};
