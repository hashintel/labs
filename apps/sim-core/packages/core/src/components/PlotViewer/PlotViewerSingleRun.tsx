import React, { FC, useState } from "react";
import { useModal } from "react-modal-hook";

import { ErrorNotification } from "./ErrorNotification";
import { ModalPlots } from "../Modal/Analysis/ModalPlots";
import { OutputPlot } from "./OutputPlot";
import { PlotViewerProps } from "./types";
import { PlotViewerTitleContainer } from "./PlotViewerTitleContainer";
import { SimulationViewerLazyTab } from "../SimulationViewer/LazyTab/SimulationViewerLazyTab";
import { displayRunId } from "../SimulationRunId/SimulationRunId";
import {
  getPlotTypeFromDataDefinition,
  getXAxisItemsFromDataDefinition,
  getYAxisItemsFromDataDefinition,
} from "../Analysis/modals";
import {
  selectCurrentExperimentData,
  selectCurrentSimStepRetention,
  selectCurrentSimulationId,
} from "../../features/simulator/simulate/selectors";
import { usePlots } from "./hooks";
import { useSimulatorSelector } from "../../features/simulator/context";

export const PlotViewerSingleRun: FC<PlotViewerProps> = ({
  readonly,
  ...props
}) => {
  const runId = useSimulatorSelector(selectCurrentSimulationId);
  const { retentionPolicy } = useSimulatorSelector(
    selectCurrentSimStepRetention,
  );
  const plots = usePlots()[runId];

  const experimentData = useSimulatorSelector(selectCurrentExperimentData);
  const plan = experimentData?.plan[runId];

  const [currentPlotKey, setCurrentPlotKey] = useState(0);
  const { onPlotsModalSave, onPlotsModalDelete, outputs } = props;

  const [showPlotsModal, hidePlotsModal] = useModal(() => {
    if (
      !plots?.[currentPlotKey].definition?.data &&
      !plots?.[currentPlotKey].definition?.timeseries
    ) {
      return null;
    }
    const currentPlotDefinition = plots[currentPlotKey].definition;
    const XAxisItems = getXAxisItemsFromDataDefinition(currentPlotDefinition);
    const YAxisItems = getYAxisItemsFromDataDefinition(currentPlotDefinition);
    const plotChartType = getPlotTypeFromDataDefinition(currentPlotDefinition);

    return (
      <ModalPlots
        outputs={outputs}
        onClose={hidePlotsModal}
        onDelete={onPlotsModalDelete}
        onSave={onPlotsModalSave}
        plotKey={currentPlotKey}
        plotChartType={plotChartType}
        plotTitle={currentPlotDefinition.title}
        layout={currentPlotDefinition.layout}
        isCreate={false}
        YAxisItems={YAxisItems}
        XAxisItems={XAxisItems}
      />
    );
  }, [currentPlotKey, outputs, onPlotsModalDelete, onPlotsModalSave, plots]);

  const metricKeys = Object.keys(outputs);
  const invalidPlots = !plots
    ? []
    : plots
        .map((plot) => {
          const isPlotValid =
            plot.outputProps.key && !plot.definition.isInvalid;
          if (isPlotValid) {
            return null;
          }
          const definedKeys: string[] =
            plot.definition.data?.map((item) => String(item.y)) || [];
          const missingKeys: string[] = definedKeys?.filter(
            (key) => !metricKeys.includes(key),
          );
          return { plot, missingKeys };
        })
        .filter((plotWithKeys) => plotWithKeys);

  return !plots ? (
    <SimulationViewerLazyTab immediate />
  ) : (
    <div className="PlotViewer">
      {plots.length === 0 ? (
        <div className="empty">
          <h3>No plots specified</h3>
        </div>
      ) : (
        <>
          <PlotViewerTitleContainer>
            {plan ? (
              <>
                {experimentData?.experimentName ?? experimentData?.experimentId}
                <span className="PlotViewer__Header__Sub">
                  &nbsp;— run #
                  {displayRunId(runId, experimentData?.target === "cloud")}
                </span>
              </>
            ) : (
              <>
                Single-run
                <span className="PlotViewer__Header__Sub">
                  &nbsp;#{displayRunId(runId)}
                </span>
              </>
            )}
            {retentionPolicy === "some" && (
              <span className="PlotViewer__Header__StepRetentionWarning">
                Selective step retention active: analysis tab must remain
                focused while computing to generate all plot data.
              </span>
            )}
          </PlotViewerTitleContainer>
          <div className="PlotViewer__Plots">
            {plots.map((plot, index) => {
              const isPlotValid =
                plot.outputProps.key && !plot.definition.isInvalid;
              return (
                <div key={plot.outputProps.key} style={plot.outputProps.style}>
                  {!isPlotValid && (
                    <ErrorNotification
                      plots={invalidPlots.filter(
                        (inv) =>
                          inv?.plot.outputProps.key === plot.outputProps.key,
                      )}
                    />
                  )}
                  {isPlotValid && (
                    <OutputPlot
                      {...props}
                      {...plot.outputProps}
                      key={plot.outputProps.key}
                      data={plot.data}
                      definition={plot.definition}
                      outputs={outputs}
                      readonly={readonly}
                      onEdit={() => {
                        setCurrentPlotKey(index);
                        showPlotsModal();
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
