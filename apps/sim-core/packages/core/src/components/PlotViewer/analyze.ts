import {
  AnalyzerProvider,
  OutputSeries,
  Outputs,
  PlotDefinition,
  SimulationStates,
} from "@hashintel/engine-web";

import { OutputPlotProps } from "./types";
import { buildData, buildPlots } from "./utils";
import analyzerWorkerUrl from "../../workers/analyzer-worker/index?worker&url";

export const analyzer = new AnalyzerProvider(analyzerWorkerUrl);
interface PlotDefinitionIsInvalidType {
  isInvalid?: boolean;
}

export interface PlotDataItem {
  definition: PlotDefinition & PlotDefinitionIsInvalidType;
  outputProps: OutputPlotProps;
  data: Plotly.Data[];
}
export type PlotDataMap = Record<string, PlotDataItem>;

export interface OutputPlots {
  outputs: OutputSeries;
  /**
   * @todo what is this for – we don't have it in cloud analysis which makes
   *       things tricky
   */
  rawOutputs: Outputs[];
  plots: PlotDataMap;
}

/**
 * Analyzing returns an array of output maps.
 * Outputs are specified in the analysis schema and then used to build plots.
 *
 * Input:
 * ---
 * Outputs: {
 *  [id]: {..some json operation map}
 * }
 *
 * Analysis:
 * ---
 * Outputs: {
 *  [id]: <single computed value>
 * }
 *
 * analyzer.analyze() ->  {[outputId]: value}[]
 */
export const refreshAnalysisSource = async (
  source: string,
  // simId: string
): Promise<OutputPlots> => {
  const { plots } = await analyzer.setAnalysisSrc(source);

  // Build the plot map from the definitions
  const emptyPlots: PlotDataMap = {};
  for (const plotDef of plots) {
    emptyPlots[plotDef.title] = {
      data: [],
      definition: plotDef,
      outputProps: buildPlots(plotDef),
    };
  }

  return {
    outputs: {},
    plots: emptyPlots,
    rawOutputs: [],
  };
};

export const analyzeSteps = async (
  agentData: SimulationStates,
  lastOutputs: Outputs[] = [],
  stepsCount: number,
): Promise<{ total: Outputs[]; added: Outputs[] }> => {
  if (lastOutputs.length === stepsCount) {
    return { total: lastOutputs, added: [] };
  }

  const selectedSteps = [];
  for (
    let nextStepIndex = lastOutputs.length;
    nextStepIndex < stepsCount;
    nextStepIndex++
  ) {
    // send empty data if data hasn't been retained
    // to indicate where parts of a timeseries are missing
    selectedSteps.push(agentData[nextStepIndex] ?? []);
  }

  const { outputs } = await analyzer.analyze(selectedSteps);

  return { total: [...lastOutputs, ...outputs], added: outputs };
};

export const mutatingPlotData = (
  outputs: OutputSeries,
  plots: PlotDataMap,
  stepCount: number,
) => {
  // Build that data on the plot definitions

  const metricKeys = Object.keys(outputs);
  for (const plot of Object.values(plots)) {
    // check that the Plots are referencing a valid metric
    let referencesValidMetricKeys = true;
    if (plot?.definition?.data && !Array.isArray(plot.definition.data)) {
      plot.definition.data = [plot.definition.data];
    }
    plot?.definition?.data?.forEach((axisItem) => {
      if (
        !metricKeys.includes(String(axisItem.y)) &&
        !metricKeys.includes(String(axisItem.x)) &&
        !plot.definition.timeseries
      ) {
        referencesValidMetricKeys = false;
        plot.definition.isInvalid = true;
      }
    });
    plot.data = referencesValidMetricKeys
      ? buildData(plot.definition, outputs, stepCount - 1)
      : [];
  }
};

export const mutatingUpdatePlotsForSingleRun = async (
  agentData: SimulationStates,
  plotsData: OutputPlots,
  stepsCount: number,
): Promise<OutputPlots> => {
  const { outputs, plots, rawOutputs } = plotsData;

  const analysis = await analyzeSteps(agentData, rawOutputs, stepsCount);

  if (analysis.added.length === 0) {
    return plotsData;
  }

  const addedOutputs = analysis.added;

  // Take the output map and push them into a series

  for (const outMap of addedOutputs) {
    for (const [id, val] of Object.entries(outMap)) {
      if (!outputs[id]) {
        outputs[id] = [];
      }
      outputs[id].push(val);
    }
  }

  const stepCount = analysis.total.length;
  mutatingPlotData(outputs, plots, stepCount);

  // Set data and increment the analysis slice
  return {
    outputs,
    plots,
    rawOutputs: analysis.total,
  };
};
