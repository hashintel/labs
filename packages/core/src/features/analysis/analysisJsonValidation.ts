import {
  AggregatorOperator,
  Chart,
  CountOperator,
  CumulativeAggregateOperator,
  CumulativeAggregationOperation,
  FilterComparator,
  FilterOperation,
  FilterOperator,
  GetOperation,
  GetOperator,
  Output,
  OutputOperation,
  Plot,
  Timeseries,
  UncheckedAnalysisJson,
} from "./analysisJsonTypes";
import {
  AnalysisJsonHasNoOutputsError,
  AnalysisJsonHasNoPlotsError,
  AnalysisJsonHasUnusedOutputsWarning,
  NotImplementedError,
  OperationChainCantHaveAnyOperationAfterAnAggregationOperationError,
  OperationChainFirstGetFieldMustBeAStringError,
  OperationChainFirstOperationCanNotBeAnAggregationError,
  OperationChainMustBeAnArrayError,
  OperationChainMustContainAtLeastOneOperationError,
  OutputOperationError,
  OutputOperationGetBooleanFilterIsUsingWrongComparisonError,
  OutputOperationHasComplexValuesError,
  OutputOperationHasExtraFieldsError,
  OutputOperationHasInvalidValuesError,
  OutputOperationIsMissingOperationError,
  OutputOperationIsMissingRequiredFieldsError,
  OutputOperationMustBeANumberError,
  OutputOperationMustBeANumberOrStringError,
  PlotHasEmptyDataObjectError,
  PlotHasNoDataError,
  PlotHasNoTitleError,
  PlotHasNoTypeError,
  PlotIsMissingLayoutComponentError,
  PlotIsMissingPositionComponentError,
  UnhandledOutputOperationError,
  UnhandledPlotTypeError,
} from "./errors";
import {
  BarChartValidator,
  BoxValidator,
  HistogramValidator,
  LineOrScatterValidator,
  TimeseriesValidator,
} from "./plotValidations";
import {
  allOutputsAreUsedInPlots,
  getExtraFields,
  getFirstGetOperation,
  getMissingFields,
  getNonArrayPlotDataWarnings,
  getUnusedOutputs,
  getValidPlotTypes,
  isAnAggregationOperation,
  isComplexValue,
  isStringOrNumber,
  operationHasExtraFields,
  operationHasMissingFields,
  standardizePlot,
} from "./utils";

// TODO: add the other error types that we can output
type ValidateOutputOperationReturnType =
  | true
  | OutputOperationError
  | UnhandledOutputOperationError
  | OutputOperationHasExtraFieldsError
  | OutputOperationHasInvalidValuesError
  | OutputOperationIsMissingRequiredFieldsError
  | OutputOperationMustBeANumberError
  | OutputOperationHasComplexValuesError
  | NotImplementedError;
// This checks that the operation has a valid field for the 'op' type,
// and contains the required fields for that op, and no other. e.g.
// - a count should not have any other fields
// - an aggregate must have a valid 'by'
// and so on, following the TypeScript typings in analysisJsonTypes.
export const validateOutputOperation = (
  operation?: Partial<OutputOperation>,
): ValidateOutputOperationReturnType => {
  if (!operation?.op) {
    return new OutputOperationIsMissingOperationError();
  }
  const operationKeys = Object.keys(operation);
  const opName = String(operation.op);
  switch (opName) {
    case AggregatorOperator.max:
    case AggregatorOperator.min:
    case AggregatorOperator.mean:
    case AggregatorOperator.sum:
    case CountOperator.count: {
      // confirm we have no extra fields
      if (operationKeys.length > 1) {
        const extraFields = operationKeys.filter((key) => key !== "op");
        return new OutputOperationHasExtraFieldsError(
          operation.op,
          extraFields,
        );
      }
      break;
    }

    case CumulativeAggregateOperator.aggregate: {
      const aggregateOperation: CumulativeAggregationOperation = JSON.parse(
        JSON.stringify(operation),
      );
      const aggregationOperations = Object.values(AggregatorOperator);
      if (!aggregateOperation.by) {
        return new OutputOperationIsMissingRequiredFieldsError(operation.op, [
          "by",
        ]);
      }
      // TODO: find a way to check if the field referenced in the `by` property exists
      if (!aggregationOperations.includes(aggregateOperation.by)) {
        return new OutputOperationHasInvalidValuesError(
          operation.op,
          "by",
          aggregationOperations,
        );
      }
      if (
        aggregateOperation.range &&
        (isNaN(aggregateOperation.range) ||
          (!isNaN(aggregateOperation.range) && aggregateOperation.range <= 0))
      ) {
        return new OutputOperationMustBeANumberError(operation.op, "range");
      }
      break;
    }

    case FilterOperator.filter: {
      const filterOperation: FilterOperation = JSON.parse(
        JSON.stringify(operation),
      );
      const requiredFields = ["op", "field", "comparison", "value"];

      if (operationHasMissingFields(operationKeys, requiredFields)) {
        return new OutputOperationIsMissingRequiredFieldsError(
          operation.op,
          getMissingFields(operationKeys, requiredFields),
        );
      }
      if (operationHasExtraFields(operationKeys, requiredFields)) {
        return new OutputOperationHasExtraFieldsError(
          operation.op,
          getExtraFields(operationKeys, requiredFields),
        );
      }

      if (!isStringOrNumber(filterOperation.field)) {
        return new OutputOperationMustBeANumberOrStringError(
          operation.op,
          "field",
        );
      }

      const validFilterComparators = [
        FilterComparator.eq,
        FilterComparator.neq,
        FilterComparator.gt,
        FilterComparator.gte,
        FilterComparator.lt,
        FilterComparator.lte,
      ];
      if (!validFilterComparators.includes(filterOperation.comparison)) {
        return new OutputOperationHasInvalidValuesError(
          operation.op,
          "comparison",
          validFilterComparators,
        );
      }

      const valueIsComplex = isComplexValue(filterOperation.value);
      if (valueIsComplex) {
        return new OutputOperationHasComplexValuesError(operation.op, "value");
      }

      // - "filter" with "value" of boolean or null must have 'comparison' 'eq' or 'neq'
      if (
        typeof filterOperation.value === "boolean" &&
        filterOperation.comparison !== FilterComparator.eq &&
        filterOperation.comparison !== FilterComparator.neq
      ) {
        return new OutputOperationGetBooleanFilterIsUsingWrongComparisonError(
          filterOperation.comparison,
        );
      }
      // - "filter" on a non-any typed field must have a value of the same type
      break;
    }

    case GetOperator.get: {
      const getOperation: GetOperation = JSON.parse(JSON.stringify(operation));
      const requiredFields = ["op", "field"];

      if (operationHasMissingFields(operationKeys, requiredFields)) {
        return new OutputOperationIsMissingRequiredFieldsError(
          operation.op,
          getMissingFields(operationKeys, requiredFields),
        );
      }
      if (operationHasExtraFields(operationKeys, requiredFields)) {
        return new OutputOperationHasExtraFieldsError(
          operation.op,
          getExtraFields(operationKeys, requiredFields),
        );
      }
      if (!isStringOrNumber(getOperation.field)) {
        return new OutputOperationMustBeANumberOrStringError(
          operation.op,
          "field",
        );
      }
      break;
    }

    default:
      return new UnhandledOutputOperationError(operation.op);
  }

  return true;
};

/**
 * The rules used for validation are defined on https://www.notion.so/hashintel/Top-Plots-6e34aa5d0a7344edb197e48918fb09f7
 * @param outputs
 */
export const validateOutput = (
  outputs?: Partial<OutputOperation[]>,
  outputKey?: string,
) => {
  if (!Array.isArray(outputs)) {
    return new OperationChainMustBeAnArrayError(outputs, outputKey);
  }
  if (outputs.length === 0) {
    // - the chain must contain at least one output
    return new OperationChainMustContainAtLeastOneOperationError(outputKey);
  }
  // 1. Check that the chain itself does not violate certain rules:
  const firstGetOperation: false | GetOperation = getFirstGetOperation(outputs);
  if (firstGetOperation && typeof firstGetOperation.field !== "string") {
    return new OperationChainFirstGetFieldMustBeAStringError(outputKey);
  }
  if (isAnAggregationOperation(outputs[0])) {
    return new OperationChainFirstOperationCanNotBeAnAggregationError(
      outputKey,
    );
  }
  for (let index = 0; index < outputs.length; index++) {
    if (
      isAnAggregationOperation(outputs[index]) &&
      index < outputs.length - 1
    ) {
      return new OperationChainCantHaveAnyOperationAfterAnAggregationOperationError(
        outputKey,
      );
    }
  }
  // 2. Run validateOutputOperation on each link in the chain.
  const results = outputs.map(validateOutputOperation);
  const errors = results.filter(
    (result: any) => result instanceof OutputOperationError,
  );
  return errors.length > 0 ? errors : true;
  // - "filter" on a non-any typed field must have a value of the same type ❓ <-- delayed until we have Behavior Keys data fed into this method.
};

export const validatePlot = (
  plot?: Partial<Omit<Plot, "timeseries">>,
  outputs?: Partial<Output>,
) => {
  if (!plot || !outputs) {
    // TODO: return error, but we shouldn't get to this situation
    return false;
  }
  const clone = JSON.parse(JSON.stringify(plot));
  const cleanPlot = standardizePlot(clone);
  if (!cleanPlot.title || cleanPlot.title.trim() === "") {
    return new PlotHasNoTitleError();
  }
  // TODO: check layout.height and layout.width to confirm they end with `%` or `px`
  if (
    cleanPlot.layout &&
    (!cleanPlot.layout.height || !cleanPlot.layout.width)
  ) {
    return new PlotIsMissingLayoutComponentError(
      cleanPlot.title,
      cleanPlot.layout.height,
      cleanPlot.layout.width,
    );
  }
  if (cleanPlot.position && (!cleanPlot.position.x || !cleanPlot.position.y)) {
    return new PlotIsMissingPositionComponentError(
      cleanPlot.title,
      cleanPlot.position.x,
      cleanPlot.position.y,
    );
  }
  if (!cleanPlot.type) {
    return new PlotHasNoTypeError(cleanPlot.title);
  }
  if (!getValidPlotTypes().includes(cleanPlot.type)) {
    return new UnhandledPlotTypeError(cleanPlot.title, cleanPlot.type);
  }
  if (!cleanPlot.data) {
    return new PlotHasNoDataError(cleanPlot.title);
  }
  for (const currentDataItem of cleanPlot.data) {
    if (Object.keys(currentDataItem).length === 0) {
      return new PlotHasEmptyDataObjectError(cleanPlot.title);
    }
  }

  // 1. Based on plot type, determine what its output source is
  switch (cleanPlot.type) {
    case "bar": {
      return BarChartValidator(cleanPlot, outputs);
    }

    case "box": {
      return BoxValidator(cleanPlot, outputs);
    }

    // case "contour":
    // case "heatmap":
    // case "line3d":
    // case "scatter3d":
    //   return TwoParameterExperimentChartValidator(cleanPlot, outputs);

    case "timeseries": {
      // @ts-expect-error FIXME: this is a cryptic error
      return TimeseriesValidator(cleanPlot, outputs);
    }

    case "histogram": {
      return HistogramValidator(cleanPlot, outputs);
    }

    case "line":
    case "scatter": {
      return LineOrScatterValidator(cleanPlot, outputs);
    }

    // Note: this switch does not need a default case
    // since we are handling it above using the getValidPlotTypes function
  }
};

const generateValidateAnalysisJsonResult = (
  success: boolean,
  warnings: any[],
  errors: any[],
) => ({
  success,
  warnings,
  errors,
});

export const validateAnalysisJson = (parsedJson: UncheckedAnalysisJson) => {
  const { outputs, plots } = parsedJson;

  if (!outputs || Object.keys(outputs).length === 0) {
    return generateValidateAnalysisJsonResult(
      false,
      [],
      [new AnalysisJsonHasNoOutputsError()],
    );
  }

  if (!plots || !Array.isArray(plots) || plots.length === 0) {
    return generateValidateAnalysisJsonResult(
      false,
      [],
      [new AnalysisJsonHasNoPlotsError()],
    );
  }

  const errors: any = [];
  const warnings = [];
  // @ts-expect-error: at this point we know plots is an array
  if (!allOutputsAreUsedInPlots(outputs, plots)) {
    warnings.push(
      new AnalysisJsonHasUnusedOutputsWarning(getUnusedOutputs(outputs, plots)),
    );
  }
  // data is not an array
  const dataIsNotAnArrayWarnings = getNonArrayPlotDataWarnings(
    plots as unknown as Partial<Plot & (Chart | Timeseries)[]>,
  );
  if (dataIsNotAnArrayWarnings.length > 0) {
    dataIsNotAnArrayWarnings.forEach((warning) => warnings.push(warning));
  }
  const outputValidationErrors = Object.keys(outputs)
    .map((outputKey: string) => validateOutput(outputs[outputKey], outputKey))
    .filter((result) => result instanceof Error);
  if (outputValidationErrors.length > 0) {
    return generateValidateAnalysisJsonResult(false, warnings, [
      ...errors,
      ...outputValidationErrors,
    ]);
  }
  const plotValidationErrors = plots
    .map((plot) => validatePlot(plot, outputs))
    .filter((result) => result instanceof Error);
  if (plotValidationErrors.length > 0) {
    return generateValidateAnalysisJsonResult(false, warnings, [
      ...errors,
      ...plotValidationErrors,
    ]);
  }

  return generateValidateAnalysisJsonResult(true, warnings, errors);
};
