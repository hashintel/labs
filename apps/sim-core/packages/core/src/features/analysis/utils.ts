import levenshteinDistance from "js-levenshtein";
import { difference } from "lodash";

import {
  AggregatorOperator,
  Chart,
  CountOperator,
  GetOperation,
  GetOperator,
  Output,
  OutputOperation,
  Plot,
  Timeseries,
} from "./analysisJsonTypes";
import { PlotDataIsNotAnArrayWarning } from "./errors";

// TODO: fix types
export const getUnusedOutputs = (
  outputs: Partial<Output>,
  plots?: any
): string[] => {
  const outputKeys = Object.keys(outputs);
  const usedKeys: string[] = [];
  if (!plots || !Array.isArray(plots)) {
    return [];
  }
  plots.forEach((plot: any) => {
    if (!plot) {
      return;
    }
    if (plot.timeseries) {
      plot.timeseries.forEach((outputKey: string) => usedKeys.push(outputKey));
    }
    const newData = Array.isArray(plot?.data) ? plot.data : [plot.data];
    newData.forEach((dataPoint: any) => {
      if (dataPoint?.x || dataPoint?.y || dataPoint?.z) {
        ["x", "y", "z"].forEach((currentAxis: string) => {
          if (!dataPoint[currentAxis]) {
            return;
          }
          // cover cases where users give { "y": ["Metric1","Metric2"] }
          if (Array.isArray(dataPoint[currentAxis])) {
            dataPoint[currentAxis].forEach((currentAxisMetric: string) => {
              usedKeys.push(currentAxisMetric);
            });
          } else {
            usedKeys.push(dataPoint[currentAxis]);
          }
        });
      }
    });
  });
  const unused: string[] = [];
  outputKeys.forEach((key: string) => {
    if (!usedKeys.includes(key)) {
      unused.push(key);
    }
  });
  return unused;
};

export const allOutputsAreUsedInPlots = (
  outputs: Partial<Output>,
  plots?: Partial<Plot>[]
): boolean => getUnusedOutputs(outputs, plots).length === 0;

export const doesOutputExist = (
  outputName?: string,
  outputs?: Partial<Output>
): boolean => Object.keys(outputs ?? {}).includes(outputName ?? "");

export const getClosestMatchingOutputName = (
  outputName: string,
  outputs?: Partial<Output>
) => {
  if (!outputs) {
    return false;
  }
  const MAXIMUM_ALLOWED_DIFFERENCE = 2;
  const outputNames = Object.keys(outputs);
  if (Object.keys(outputs).length === 0) {
    return false;
  }
  let shortestDistance = 99999;
  let closestMatch = "";
  outputNames.forEach((currentOutputName) => {
    const distance = levenshteinDistance(outputName, currentOutputName);
    if (shortestDistance > distance) {
      shortestDistance = distance;
      closestMatch = currentOutputName;
    }
  });
  if (shortestDistance <= MAXIMUM_ALLOWED_DIFFERENCE) {
    return closestMatch;
  }
  return false;
};

export const getFirstGetOperation = (operations: any) => {
  const result: GetOperation[] = operations.filter(
    (operation: GetOperation) => operation.op === GetOperator.get
  );
  return result.length === 0 ? false : result[0];
};

export const isAnAggregationOperation = (op?: Partial<OutputOperation>) => {
  if (!op) {
    return false;
  }
  const isMax = op.op === AggregatorOperator.max;
  const isMin = op.op === AggregatorOperator.min;
  const isMean = op.op === AggregatorOperator.mean;
  const isSum = op.op === AggregatorOperator.sum;
  return isMax || isMin || isMean || isSum;
};

export const isASingleStepAggregationOperation = (
  op: Partial<OutputOperation>
) => isAnAggregationOperation(op) || op.op === CountOperator.count;

export const getExtraFields = (allProps: string[], validFields: string[]) =>
  allProps.filter((op) => !validFields.includes(op));

export const operationHasExtraFields = (
  operationKeys: string[],
  requiredFields: string[]
) => getExtraFields(operationKeys, requiredFields).length > 0;

export const getMissingFields = (
  allProps: string[],
  requiredFields: string[]
) => difference(requiredFields, allProps);

export const operationHasMissingFields = (
  allProps: string[],
  requiredFields: string[]
) => getMissingFields(allProps, requiredFields).length > 0;

export const isComplexValue = (input: any) => {
  const valueIsAString = typeof input === "string";
  const valueIsANumber = isFinite(input);
  const valueIsBoolean = input === true || input === false;
  const valueIsNull = input === null;
  return !valueIsAString && !valueIsANumber && !valueIsBoolean && !valueIsNull;
};

export const isStringOrNumber = (input: any) => {
  const valueIsAString = typeof input === "string";
  const valueIsANumber = isFinite(input) && typeof input === "number";
  return valueIsAString || valueIsANumber;
};

/** This function takes care of standardizing the input that validatePlot will receive.
 * For example, it takes the `timeseries` property and transforms it into `type: "timeseries"`
 * and `data: YDataPoints[]`
 */
export const standardizePlot = (input: Plot) => {
  const cleanPlot = JSON.parse(JSON.stringify(input));
  if (cleanPlot.timeseries) {
    cleanPlot.type = "timeseries";
    const keys = Object.values(cleanPlot.timeseries);
    cleanPlot.data = keys.map((key) => ({ y: key, name: key }));
    delete cleanPlot[`timeseries`];
  }
  // if users provide an object for the data attribute, standardize it as an array
  if (cleanPlot.data && !Array.isArray(cleanPlot.data)) {
    cleanPlot.data = [cleanPlot.data];
  }
  return cleanPlot;
};

export const getNonArrayPlotDataWarnings = (
  plots?: Partial<Plot & (Chart | Timeseries)[]>
) =>
  Array.isArray(plots)
    ? plots
        .map((plot) => {
          if (plot?.data && !Array.isArray(plot?.data)) {
            return (
              // @ts-ignore
              new PlotDataIsNotAnArrayWarning(plot.title, plot.data)
            );
          }
        })
        .filter((item) => item)
    : [];

export const getValidPlotTypes = () => [
  "area",
  "bar",
  "box",
  "contour",
  "heatmap",
  "line3d",
  "scatter3d",
  "timeseries",
  "histogram",
  "line",
  "scatter",
];
