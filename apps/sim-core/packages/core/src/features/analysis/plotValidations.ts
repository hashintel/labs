import {
  Chart,
  GetOperator,
  Output,
  Plot,
  Timeseries,
} from "./analysisJsonTypes";
import {
  PlotDataIsNotAnArrayError,
  PlotHasAnInvalidItemInTheDataArrayError,
  PlotHasEmptyDataError,
  PlotHasEmptyDataObjectError,
  PlotHasExtraDataFieldsError,
  PlotHasNoDataError,
  PlotHasTheWrongKindOfDataError,
  PlotHasTheWrongTypeForYDataPointComponentError,
  PlotIsMissingYAndOptionallyXDataPointsComponentError,
  PlotIsMissingYAndXDataPointsComponentError,
  PlotIsMissingYDataPointsComponentError,
  PlotIsReferencingNonExistingOutputError,
  PlotLineOrScatterBothAxesMustBeInSyncError,
  PlotLineOrScatterDoesNotSupportNameError,
  PlotUsedOutputMustEndInAggregationOperationError,
} from "./errors";
import {
  doesOutputExist,
  getClosestMatchingOutputName,
  isASingleStepAggregationOperation,
} from "./utils";

const baseValidations = (
  plot: Partial<Plot & Chart>,
  defaultTitle: string,
  expectedShape:
    | "XDataPoints"
    | "YDataPoints"
    | "ZDataPoints"
    | "XDataPoints or YDataPoints"
    | "XDataPoints and YDataPoints",
) => {
  if (!plot.data) {
    return new PlotHasNoDataError(plot?.title ?? defaultTitle);
  }
  if (!Array.isArray(plot.data)) {
    return new PlotDataIsNotAnArrayError(plot?.title, expectedShape);
  }
  if (plot.data.length === 0) {
    return new PlotHasEmptyDataError(
      plot?.title ?? defaultTitle,
      expectedShape,
    );
  }
  for (let index = 0; index < plot.data.length; index++) {
    if (typeof plot.data[index] !== "object") {
      return new PlotHasAnInvalidItemInTheDataArrayError(
        plot?.title ?? defaultTitle,
        expectedShape,
      );
    }
    if (Object.keys(plot.data[index]).length === 0) {
      return new PlotHasEmptyDataObjectError(
        plot?.title ?? defaultTitle,
        expectedShape,
      );
    }
  }
  return true;
};

export const BarChartValidator = (
  cleanPlot?: Partial<Omit<Plot, "timeseries">>,
  outputs?: Partial<Output>,
) => {
  const currentPlot = JSON.parse(JSON.stringify(cleanPlot));
  const baseValidationErrors = baseValidations(
    currentPlot,
    "bar",
    "YDataPoints",
  );
  if (baseValidationErrors instanceof Error) {
    return baseValidationErrors;
  }

  for (const currentPlotDataItem of currentPlot.data) {
    if (Object.keys(currentPlotDataItem).length > 2) {
      return new PlotHasExtraDataFieldsError(cleanPlot?.title, "YDataPoints");
    }
    if (currentPlotDataItem.x || currentPlotDataItem.z) {
      return new PlotHasTheWrongKindOfDataError(
        cleanPlot?.title,
        "YDataPoints",
        currentPlotDataItem,
      );
    }
    if (!currentPlotDataItem.y) {
      return new PlotIsMissingYDataPointsComponentError(cleanPlot?.title);
    }
    if (typeof currentPlotDataItem.y !== "string") {
      return new PlotHasTheWrongTypeForYDataPointComponentError(
        cleanPlot?.title,
        currentPlotDataItem.y,
      );
    }
    if (!doesOutputExist(currentPlotDataItem.y, outputs)) {
      const closestMatch =
        getClosestMatchingOutputName(currentPlotDataItem.y, outputs) ||
        undefined;
      return new PlotIsReferencingNonExistingOutputError(
        cleanPlot?.title,
        "y",
        currentPlotDataItem.y,
        closestMatch,
      );
    }
    const output: any = outputs?.[String(currentPlotDataItem.y)];
    const lastOperation = output[output.length - 1];
    // max min mean sum count
    if (lastOperation && !isASingleStepAggregationOperation(lastOperation)) {
      return new PlotUsedOutputMustEndInAggregationOperationError(
        cleanPlot?.title,
        currentPlotDataItem.y,
      );
    }
  }

  return true;
};

export const BoxValidator = (
  cleanPlot?: Partial<Omit<Plot, "timeseries">>,
  outputs?: Partial<Output>,
) => {
  const currentPlot = JSON.parse(JSON.stringify(cleanPlot));
  const baseValidationErrors = baseValidations(
    currentPlot,
    "box plot",
    "YDataPoints",
  );
  if (baseValidationErrors instanceof Error) {
    return baseValidationErrors;
  }
  for (const currentPlotDataItem of currentPlot.data) {
    if (Object.keys(currentPlotDataItem).length > 2) {
      return new PlotHasExtraDataFieldsError(cleanPlot?.title, "YDataPoints");
    }
    // @ts-ignore we know that it expects y items. This is just for better errors
    if (currentPlotDataItem.x || currentPlotDataItem.z) {
      return new PlotHasTheWrongKindOfDataError(
        cleanPlot?.title,
        "YDataPoints",
        currentPlotDataItem,
      );
    }
    if (!currentPlotDataItem.y) {
      return new PlotIsMissingYDataPointsComponentError(cleanPlot?.title);
    }
    if (Array.isArray(currentPlotDataItem.y)) {
      return new PlotHasTheWrongTypeForYDataPointComponentError(
        cleanPlot?.title,
        currentPlotDataItem.y,
      );
    }
    if (!doesOutputExist(currentPlotDataItem.y, outputs)) {
      const closestMatch =
        getClosestMatchingOutputName(currentPlotDataItem.y, outputs) ||
        undefined;
      return new PlotIsReferencingNonExistingOutputError(
        cleanPlot?.title,
        "y",
        currentPlotDataItem.y,
        closestMatch,
      );
    }
  }
  return true;
};

const TimeseriesDataFieldValidator = (
  data: any,
  cleanPlot?: Partial<Omit<Plot, "type">>,
  outputs?: Output,
) => {
  if (Object.keys(data).length > 2) {
    return new PlotHasExtraDataFieldsError(cleanPlot?.title, "YDataPoints");
  }
  // @ts-ignore at this point we expect .y
  if (data?.x || data?.z) {
    return new PlotHasTheWrongKindOfDataError(
      cleanPlot?.title,
      "YDataPoints",
      data,
    );
  }
  if (!data.y) {
    return new PlotIsMissingYDataPointsComponentError(cleanPlot?.title, true);
  }
  if (!doesOutputExist(data.y, outputs)) {
    const closestMatch =
      getClosestMatchingOutputName(data.y, outputs) || undefined;
    return new PlotIsReferencingNonExistingOutputError(
      cleanPlot?.title,
      "y",
      data.y,
      closestMatch,
    );
  }
  return true;
};

export const TimeseriesValidator = (
  cleanPlot?: Partial<Omit<Plot, "type">>,
  outputs?: Output,
) => {
  const currentPlot: Timeseries = JSON.parse(JSON.stringify(cleanPlot));
  const baseValidationErrors = baseValidations(
    currentPlot,
    "timeseries",
    "YDataPoints",
  );
  if (baseValidationErrors instanceof Error) {
    return baseValidationErrors;
  }
  const errors: Error[] = [];
  for (const currentPlotDataItem of currentPlot.data) {
    if (Object.keys(currentPlotDataItem).length === 0) {
      return new PlotHasEmptyDataObjectError(
        cleanPlot?.title ?? "timeseries",
        "YDataPoints",
      );
    }
    const err = TimeseriesDataFieldValidator(
      currentPlotDataItem,
      cleanPlot,
      outputs,
    );
    if (err instanceof Error) {
      errors.push(err);
    }
  }
  return errors.length > 0 ? errors[0] : true;
};

export const HistogramValidator = (
  cleanPlot?: Partial<Omit<Plot, "timeseries">>,
  outputs?: Partial<Output>,
) => {
  const currentPlot = JSON.parse(JSON.stringify(cleanPlot));
  const baseValidationErrors = baseValidations(
    currentPlot,
    "histogram plot",
    "XDataPoints or YDataPoints",
  );
  if (baseValidationErrors instanceof Error) {
    return baseValidationErrors;
  }
  for (const data of currentPlot.data) {
    if (Object.keys(data).length === 0) {
      return new PlotHasEmptyDataObjectError(
        cleanPlot?.title ?? "histogram plot",
        "XDataPoints or YDataPoints",
      );
    }
    let foundAtLeastOneValidDataPoint = false;
    if (Object.keys(data).length > 2) {
      return new PlotHasExtraDataFieldsError(
        cleanPlot?.title,
        "XDataPoints or YDataPoints",
      );
    }
    if (data.z) {
      return new PlotHasTheWrongKindOfDataError(
        cleanPlot?.title,
        "XDataPoints or YDataPoints",
        data,
      );
    }
    let currentDataPointIs: "x" | "y" | "z" | "" = "";
    if (data.y) {
      currentDataPointIs = "y";
      foundAtLeastOneValidDataPoint = true;
    }
    if (data.x) {
      currentDataPointIs = "x";
      foundAtLeastOneValidDataPoint = true;
    }
    if (!foundAtLeastOneValidDataPoint || currentDataPointIs === "") {
      return new PlotIsMissingYAndXDataPointsComponentError(cleanPlot?.title);
    }
    if (!doesOutputExist(data[currentDataPointIs], outputs)) {
      const closestMatch =
        getClosestMatchingOutputName(data[currentDataPointIs], outputs) ||
        undefined;
      return new PlotIsReferencingNonExistingOutputError(
        cleanPlot?.title,
        currentDataPointIs,
        data[currentDataPointIs],
        closestMatch,
      );
    }
  }

  return true;
};

const LineOrScatterCheckOutputExistence = (
  key: string,
  plotTitle: string,
  axis: "x" | "y",
  outputs?: Partial<Output>,
) => {
  const outputExists = doesOutputExist(key, outputs);
  if (outputExists) {
    return true;
  }
  const closestMatch = getClosestMatchingOutputName(key, outputs) || undefined;
  return new PlotIsReferencingNonExistingOutputError(
    plotTitle,
    axis,
    key,
    closestMatch,
  );
};

const LineOrScatterValidatorBothAxes = (
  currentPlot?: Plot & Chart,
  outputs?: Partial<Output>,
) => {
  if (!currentPlot) {
    return false;
  }
  // ensure both x and y are using the same data source
  // @ts-ignore fixme
  const errors = currentPlot.data.map((currentPlotDataItem) => {
    const xKey = currentPlotDataItem.x;
    const yKey = currentPlotDataItem.y;
    const xOutputExists = LineOrScatterCheckOutputExistence(
      xKey,
      currentPlot.title,
      "x",
      outputs,
    );
    const yOutputExists = LineOrScatterCheckOutputExistence(
      yKey,
      currentPlot.title,
      "y",
      outputs,
    );
    if (xOutputExists instanceof Error) {
      return xOutputExists;
    }
    if (yOutputExists instanceof Error) {
      return yOutputExists;
    }
    if (xOutputExists === true && yOutputExists === true) {
      // @ts-ignore we already checked this above
      const outputMetric = outputs[xKey][outputs[xKey].length - 1] ?? {};
      const outputMetricEndsInGet = outputMetric.op === GetOperator.get;
      // @ts-ignore we already checked this above
      const outputMetricY = outputs[yKey][outputs[yKey].length - 1] ?? {};
      const outputMetricYEndsInGet = outputMetricY.op === GetOperator.get;
      if (outputMetricEndsInGet !== outputMetricYEndsInGet) {
        return new PlotLineOrScatterBothAxesMustBeInSyncError(
          currentPlot.title,
        );
      }
    }
  });
  return errors.length > 0 ? errors : true;
};
const LineOrScatterValidatorYAxis = (
  _currentPlot: Partial<Plot>,
  _outputs?: Partial<Output>,
) => {
  // currently we have no special validation for this case, but we will soon
  return true;
};

export const LineOrScatterValidator = (
  cleanPlot?: Partial<Omit<Plot, "timeseries">>,
  outputs?: Partial<Output>,
) => {
  const currentPlot = JSON.parse(JSON.stringify(cleanPlot));
  const baseValidationErrors = baseValidations(
    currentPlot,
    "line or scatter",
    "XDataPoints or YDataPoints",
  );
  if (baseValidationErrors instanceof Error) {
    return baseValidationErrors;
  }

  const errors: Error[] = [];
  for (const currentPlotDataItem of currentPlot.data) {
    if (currentPlotDataItem.name) {
      errors.push(
        new PlotLineOrScatterDoesNotSupportNameError(cleanPlot?.title),
      );
      return;
    }
    if (!currentPlotDataItem.y) {
      errors.push(
        new PlotIsMissingYDataPointsComponentError(cleanPlot?.title, true),
      );
    } else if (currentPlotDataItem.y && currentPlotDataItem.x) {
      const result = LineOrScatterValidatorBothAxes(currentPlot, outputs);
      if (Array.isArray(result)) {
        result.forEach((error) => errors.push(error));
      }
    } else if (currentPlotDataItem.y) {
      const result = LineOrScatterValidatorYAxis(currentPlot, outputs);
      if (Array.isArray(result)) {
        result.forEach((error) => errors.push(error));
      }
    } else {
      // TODO: test that we can even get to this case
      errors.push(
        new PlotIsMissingYAndOptionallyXDataPointsComponentError(
          cleanPlot?.title,
        ),
      );
    }
  }
  // TODO: improve this so all validators returns _all_ errors rather than just the first one
  return errors.length > 0 ? errors[0] : true;
};
