import { PlotDefinition } from "@hashintel/engine-web";
import { omit } from "lodash";

import { ChartTypes, Operation, Plot, YAxisItemType } from "./types";
import { ParsedAnalysis } from "../../features/files/types";
import { analysisFileId, stringifyAnalysis } from "../../features/files/utils";
import { updateFile } from "../../features/files/slice";

export const MAGIC_STEPS_KEY = "Use steps on the X Axis";

interface ModalsBaseProps {
  dispatch: Function;
  setAnalysis: Function;
  analysis: any;
  analysisString?: string;
}

interface OutputMetricsModalSubmitType {
  title: string;
  operations: Operation[];
}

type OnOutputMetricsModalSaveInputType = ModalsBaseProps & {
  data: OutputMetricsModalSubmitType;
  previousKey?: string;
};

type OnOutputMetricsModalDeleteType = ModalsBaseProps & {
  keyToDelete: string;
};

type OnDuplicateMetricType = ModalsBaseProps & {
  metricKey: string;
};

type OnPlotsModalDeleteType = ModalsBaseProps & {
  indexToDelete: number;
};

interface PlotsModalChartTypeOption {
  value: string;
  label: string;
}

interface PlotsModalYAxisItemType {
  name: string;
  metric: string;
}

interface PlotsModalXAxisItemType {
  name: string;
  metric: string;
}

interface PlotsModalLayoutType {
  width: string;
  height: string;
}

interface PlotsModalPositionType {
  x: string;
  y: string;
}

interface PlotsModalSubmitType {
  title: string;
  chartType: PlotsModalChartTypeOption;
  yitems?: PlotsModalYAxisItemType[];
  xitems?: PlotsModalXAxisItemType[];
  layout: PlotsModalLayoutType;
  position: PlotsModalPositionType;
}

type OnPlotsModalSaveType = ModalsBaseProps & {
  data: PlotsModalSubmitType;
  plotIndex?: number;
};

interface saveToAnalysisFile {
  dispatch: Function;
  setAnalysis: Function;
  analysisString?: string;
  newValues: any;
}

const saveToAnalysisFile = ({
  dispatch,
  setAnalysis,
  analysisString,
  newValues,
}: saveToAnalysisFile) => {
  const contents = stringifyAnalysis(newValues);
  dispatch(updateFile({ id: analysisFileId, contents }));
  setAnalysis({
    lastAnalysisString: analysisString ?? null,
    analysis: newValues,
    error: null,
  });
};

export const onOutputMetricsModalSave = ({
  dispatch,
  setAnalysis,
  analysisString,
  analysis,
  data,
  previousKey,
}: OnOutputMetricsModalSaveInputType) => {
  let outputs = { ...analysis.outputs, [data.title]: data.operations };
  if (
    Object.keys(analysis?.outputs ?? {}).length > 0 &&
    previousKey &&
    analysis.outputs[previousKey] &&
    previousKey !== data.title
  ) {
    outputs = omit(outputs, previousKey); // if we changed the title, delete the old one to avoid duplicates
  }
  const newValues: ParsedAnalysis = { ...analysis, outputs: outputs };
  saveToAnalysisFile({ dispatch, setAnalysis, analysisString, newValues });
};

export const onOutputMetricsModalDelete = ({
  dispatch,
  setAnalysis,
  analysisString,
  analysis,
  keyToDelete,
}: OnOutputMetricsModalDeleteType) => {
  if (!analysis?.outputs?.[keyToDelete]) {
    return;
  }
  const outputs = omit(analysis.outputs, keyToDelete);
  const newValues: ParsedAnalysis = { ...analysis, outputs: outputs };
  saveToAnalysisFile({ dispatch, setAnalysis, analysisString, newValues });
};

export const onDuplicateMetric = ({
  metricKey,
  analysis,
  analysisString,
  dispatch,
  setAnalysis,
}: OnDuplicateMetricType) => {
  if (!analysis?.outputs?.[metricKey]) {
    return;
  }
  const newOutputs = Object.assign({}, analysis.outputs);
  const metricKeyUntilUnderscoreCopy = metricKey.split("_copy")[0];
  let newKey = `${metricKeyUntilUnderscoreCopy}_copy`;
  let newKeyIndex = 1;
  while (newOutputs[newKey]) {
    newKeyIndex++;
    newKey = `${metricKeyUntilUnderscoreCopy}_copy${newKeyIndex}`;
  }
  newOutputs[newKey] = newOutputs[metricKey];
  const newValues: ParsedAnalysis = { ...analysis, outputs: newOutputs };
  saveToAnalysisFile({ dispatch, setAnalysis, analysisString, newValues });
};

// Reads the data definition and transforms it to a format understood
// by the Plots modal
export const getYAxisItemsFromDataDefinition = (
  input: PlotDefinition & any,
): YAxisItemType[] => {
  if (!input.type && input[ChartTypes.timeseries]) {
    return input.timeseries.map((metric: any) => ({
      name: metric,
      metric,
    }));
  }
  switch (input.type) {
    // http://localhost:8080/@hash/city-infection-model/6.1.1
    case ChartTypes.area:
    case ChartTypes.bar:
    case ChartTypes.box:
    case ChartTypes.timeseries:
      return (
        input.data?.map((item: any) => ({
          name: item.name ?? item.y,
          metric: item.y,
        })) ?? []
      );

    default:
      return (
        input.data
          ?.filter((item: any) => item.y)
          .map((item: any) => ({
            name: item.y,
            metric: item.y,
          })) ?? []
      );
  }
};

// Reads the data definition and transforms it to a format understood
// by the Plots modal
export const getXAxisItemsFromDataDefinition = (
  input: PlotDefinition & any,
): YAxisItemType[] => {
  if (!input.type) {
    return input.data;
  }
  return (
    input.data
      ?.filter((item: any) => item.x)
      .map((item: any) => ({
        name: item.x,
        metric: item.x,
      })) ?? []
  );
};

export const getPlotTypeFromDataDefinition = (
  input: PlotDefinition & any,
): string => input.type ?? ChartTypes.timeseries;

const chartItemLabel = (item: { name?: string; metric?: string }) =>
  item.name ?? item.metric;

export const transformPlotDataBasedOnChartType = (
  input: PlotDefinition & any,
) => {
  const result = Object.assign({}, input);
  switch (input.type) {
    // http://localhost:8080/@hash/city-infection-model/6.1.1
    case ChartTypes.area:
      result.data = input.data?.yitems?.map((item: any) => ({
        y: item.metric,
        stackgroup: "one",
        name: chartItemLabel(item),
      }));
      break;

    case ChartTypes.box:
      result.data = input.data?.yitems?.map((item: any) => ({
        y: item.metric,
        name: chartItemLabel(item),
      }));
      break;

    // http://localhost:8080/@hash/boids-3d/6.0.0
    case ChartTypes.timeseries:
      delete result.timeseries;
      result.type = "timeseries";
      result.data = input.data?.yitems?.map((item: any) => ({
        y: item.metric,
        name: chartItemLabel(item),
      }));
      break;

    // http://localhost:8080/@hash/model-market/4.2.0
    case ChartTypes.histogram:
      if (input.data?.xitems?.length > 0) {
        result.data = input.data?.xitems?.map((item: any) => ({
          x: item.metric,
          name: chartItemLabel(item),
        }));
      } else {
        result.data = input.data?.yitems?.map((item: any) => ({
          y: item.metric,
          name: chartItemLabel(item),
        }));
      }
      break;

    case ChartTypes.line:
    case ChartTypes.scatter:
      // this assumes we have both X and Y  OR we have only Y and X=steps
      const hasMagicStepsKey =
        input.data?.xitems.length === 1 &&
        input.data.xitems[0].metric === MAGIC_STEPS_KEY;
      const hasYItems = input.data?.yitems.length > 0 ?? false;
      const hasXItems = hasMagicStepsKey
        ? false
        : input.data?.xitems.length > 0;
      if (!hasYItems && !hasXItems) {
        console.log(
          "Caught invalid configuration for line or scatter plot. The validation for this should be added to the Plots modal.",
        );
        result.data = []; // we shouldnt get to this case, so prevent writing invalid stuff
      }
      if (hasYItems && !hasXItems) {
        result.data = input.data?.yitems?.map((item: any) => ({
          y: item.metric,
          name: chartItemLabel(item),
        }));
      }
      if (hasYItems && hasXItems) {
        result.data = input.data?.yitems?.map((item: any, index: number) => ({
          y: item.metric,
          x: input.data?.xitems?.[index].metric,
        }));
      }

      break;

    case ChartTypes.bar:
    default:
      result.data = input.data?.yitems?.map((item: any) => ({
        y: item.metric,
        name: chartItemLabel(item),
      }));
  }
  return result;
};

export const onPlotsModalSave = ({
  data,
  plotIndex,
  analysis,
  analysisString,
  dispatch,
  setAnalysis,
}: OnPlotsModalSaveType) => {
  // Prevent error if `plots` property isnt available
  const newAnalysis = { ...analysis };
  if (!newAnalysis.plots) {
    newAnalysis.plots = [];
  }
  const plots: Plot[] = [...newAnalysis.plots];
  const newItem = transformPlotDataBasedOnChartType({
    title: data.title,
    type: data.chartType.value,
    data: { yitems: data.yitems, xitems: data.xitems },
    layout: data.layout,
    position: data.position,
  });
  if (typeof plotIndex === "number") {
    newItem.layout = newItem.layout ?? plots[plotIndex].layout;
    newItem.position = plots[plotIndex].position;
    plots[plotIndex] = newItem;
  } else {
    plots.push(newItem);
  }

  const newValues: ParsedAnalysis = { ...newAnalysis, plots: plots };
  saveToAnalysisFile({ dispatch, setAnalysis, analysisString, newValues });
};

export const onPlotsModalDelete = ({
  indexToDelete,
  analysis,
  setAnalysis,
  dispatch,
  analysisString,
}: OnPlotsModalDeleteType) => {
  if (!analysis?.plots?.[indexToDelete]) {
    return;
  }
  // remove the item and reset the Y position
  let combinedHeight = 0;
  const plots = [...analysis.plots]
    .filter((_item, index) => index !== indexToDelete)
    .map((item: any) => {
      const result = {
        ...item,
        position: {
          x: item.position.x,
          y: `${combinedHeight}%`,
        },
      };
      combinedHeight =
        combinedHeight + parseInt(item.layout.height.replace("%", ""), 10);
      return result;
    });
  const newValues: ParsedAnalysis = { ...analysis, plots: plots };
  saveToAnalysisFile({ dispatch, setAnalysis, analysisString, newValues });
};
