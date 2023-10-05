import React, { FC } from "react";
import { PlannedRunVariant } from "@hashintel/engine-web";
import { sortBy } from "lodash";

import { OutputPlotCollated } from "./OutputPlotCollated";
import { PlotDataItem } from "./analyze";
import { PlotViewerProps } from "./types";
import { PlotViewerTitleContainer } from "./PlotViewerTitleContainer";
import { SimulationViewerLazyTab } from "../SimulationViewer/LazyTab/SimulationViewerLazyTab";
import {
  selectCurrentExperimentData,
  selectCurrentExperimentId,
  selectCurrentExperimentName,
} from "../../features/simulator/simulate/selectors";
import { usePlots } from "./hooks";
import { useSimulatorSelector } from "../../features/simulator/context";

const stringifyFields = (variant: PlannedRunVariant) =>
  Object.entries(variant)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ");

export const PlotViewerCollatedExperiment: FC<PlotViewerProps> = (props) => {
  const name = useSimulatorSelector(selectCurrentExperimentName);
  const id = useSimulatorSelector(selectCurrentExperimentId);
  const experiment = useSimulatorSelector(selectCurrentExperimentData);

  const plots = usePlots();
  const entries = Object.entries(plots);

  if (!entries.length) {
    return <SimulationViewerLazyTab immediate />;
  }

  const VALID_PLOT_TYPES = [
    "timeseries",
    "line",
    "scatter",
    "box",
    "histogram",
  ];

  const collatedPlots = entries.reduce<PlotDataItem[]>(
    (plots, [simId, plotSet]) => {
      if (!plotSet) {
        return plots;
      }

      plotSet.forEach((plot, idx) => {
        if (!plots[idx]) {
          plots[idx] = { ...plot, data: [] };
        }

        for (const data of plot.data) {
          // data.line.color = '#f00';
          plots[idx].data.push({
            ...data,
            name: `${data.name}${
              experiment?.plan[simId].fields
                ? ` (${stringifyFields(experiment?.plan[simId].fields)})`
                : ""
            }`,
          });
        }
      });

      return plots.filter(
        (plot) =>
          VALID_PLOT_TYPES.includes(plot.definition.type ?? "") ||
          plot.definition.timeseries
      );
    },
    []
  );

  for (const plot of collatedPlots) {
    plot.data = sortBy(plot.data, [(item) => item.name]);
  }

  return (
    <div className="PlotViewer">
      <PlotViewerTitleContainer>
        {name ?? id}
        <span className="PlotViewer__Header__Sub">
          &nbsp;— all runs (collated)
        </span>
      </PlotViewerTitleContainer>
      <div className="PlotViewer__Plots">
        {collatedPlots.map((plot) => (
          <div
            key={`collated-${plot.outputProps.key}-${Math.random()}`}
            style={plot.outputProps.style}
          >
            <OutputPlotCollated
              {...props}
              {...plot.outputProps}
              layout={{
                ...plot.outputProps.layout,
                showlegend: !plot.outputProps.hideCollatedLegend,
              }}
              data={plot.data}
              readonly
            />
          </div>
        ))}
      </div>
    </div>
  );
};
