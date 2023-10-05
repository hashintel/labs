import {
  AggregatorOperator,
  CountOperator,
  CumulativeAggregateOperator,
  FilterOperator,
  GetOperator,
  XDataPoint,
  YDataPoint,
  YDataPoints,
  ZDataPoints,
} from "./analysisJsonTypes";
import { getValidPlotTypes } from "./utils";

const AllOutputOperations = [
  AggregatorOperator.max,
  AggregatorOperator.min,
  AggregatorOperator.mean,
  AggregatorOperator.sum,
  CountOperator.count,
  CumulativeAggregateOperator.aggregate,
  FilterOperator.filter,
  GetOperator.get,
];

//TODO: remove when we are no longer using this
export class NotImplementedError extends Error {
  constructor(operation: string) {
    super(
      `The parser for the requested output operation "${operation}" hasn't been implemented yet, sorry`
    );
    this.name = "OutputOperationNotImplementedError";
  }
}

export class OutputOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutputOperationError";
  }
}
export class OutputOperationIsMissingOperationError extends OutputOperationError {
  constructor() {
    const possibleValues = AllOutputOperations.join(",");
    super(
      `The operation does not contain an op field. The possible values for this field are ${possibleValues}`
    );
    this.name = "OutputOperationIsMissingOperationError";
  }
}

export class OutputOperationHasInvalidValuesError extends OutputOperationError {
  constructor(operation: string, field: string, possibleValues?: string[]) {
    let message = `The operation "${operation}" has an invalid value for the field "${field}".`;
    if (possibleValues) {
      message = `${message} The possible values for this field are ${possibleValues.join(
        ","
      )}`;
    }
    super(message);
    this.name = "OutputOperationHasInvalidValuesError";
  }
}
export class OutputOperationIsMissingRequiredFieldsError extends OutputOperationError {
  constructor(operation: string, missingFields: string[]) {
    const singularOrPluralField =
      missingFields.length === 1 ? "field" : "fields";
    const message = `The operation "${operation}" is missing the following required ${singularOrPluralField}: "${missingFields.join(
      ","
    )}"`;
    super(message);
    this.name = "OutputOperationIsMissingRequiredFieldsError";
  }
}
export class OutputOperationHasExtraFieldsError extends OutputOperationError {
  constructor(operation: string, extraFields: string[]) {
    const message = `The operation "${operation}" contains the following extra parameters: ${extraFields.join(
      ","
    )}"`;
    super(message);
    this.name = "OutputOperationHasExtraFieldsError";
  }
}
export class OutputOperationMustBeANumberError extends OutputOperationError {
  constructor(operation: string, field: string) {
    const message = `The operation "${operation}" has an invalid value for the field "${field}". The field only accepts positive numbers.`;
    super(message);
    this.name = "OutputOperationMustBeANumberError";
  }
}
export class OutputOperationMustBeANumberOrStringError extends OutputOperationError {
  constructor(operation: string, field: string) {
    const message = `The operation "${operation}" has an invalid value for the field "${field}". The field only accepts positive numbers or strings.`;
    super(message);
    this.name = "OutputOperationMustBeANumberOrStringError";
  }
}
export class OutputOperationHasComplexValuesError extends OutputOperationError {
  constructor(operation: string, field: string) {
    const message = `The operation "${operation}" has an invalid value for the field "${field}". The field only accepts non-complex values (string, string[], number, number[])`;
    super(message);
    this.name = "OutputOperationHasComplexValuesError";
  }
}

export class OutputOperationGetBooleanFilterIsUsingWrongComparisonError extends OutputOperationError {
  constructor(comparator: string) {
    const message = `The operation "filter" is using an invalid comparison operator. You provided "${comparator}", while valid values are "eq" and "neq".`;
    super(message);
    this.name = "OutputOperationGetBooleanFilterIsUsingWrongComparisonError";
  }
}
export class UnhandledOutputOperationError extends OutputOperationError {
  constructor(operation: string) {
    const possibleValues = [
      AggregatorOperator.max,
      AggregatorOperator.min,
      AggregatorOperator.mean,
      AggregatorOperator.sum,
      CountOperator.count,
      CumulativeAggregateOperator.aggregate,
      FilterOperator.filter,
      GetOperator.get,
    ];
    super(`The provided operation "${operation}
    " is invalid. Possible values are: "${possibleValues.join(",")}"`);
    this.name = "UnhandledOutputOperationError";
  }
}
export class OperationChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationChainError";
  }
}
export class OperationChainMustBeAnArrayError extends OperationChainError {
  constructor(providedChain: any, outputKey?: string) {
    let message = `The operation chain must be an array. You provided "${(typeof providedChain).toLowerCase()}".`;
    if (outputKey) {
      message = `The operation chain for the "${outputKey}" metric must be an array. You provided "${(typeof providedChain).toLowerCase()}".`;
    }
    super(message);
    this.name = "OperationChainFirstGetFieldMustBeAStringError";
  }
}
export class OperationChainFirstGetFieldMustBeAStringError extends OperationChainError {
  constructor(outputKey?: string) {
    let message = `Your first "get" operation must access the "field" using a string.`;
    if (outputKey) {
      message = `Your first "get" operation for the "${outputKey}" metric must access the "field" using a string.`;
    }
    super(message);
    this.name = "OperationChainFirstGetFieldMustBeAStringError";
  }
}
export class OperationChainFirstOperationCanNotBeAnAggregationError extends OperationChainError {
  constructor(outputKey?: string) {
    let message = `The first operation in the chain cannot be an Aggregation operation. Valid values are "aggregate,count,filter,get".`;
    if (outputKey) {
      message = `The first operation in the chain for the "${outputKey}" metric cannot be an Aggregation operation. Valid values are "aggregate,count,filter,get".`;
    }
    super(message);
    this.name = "OperationChainFirstOperationCanNotBeAnAggregationError";
  }
}

export class OperationChainMustContainAtLeastOneOperationError extends OperationChainError {
  constructor(outputKey?: string) {
    let message = `The operation chain must contain at least one operation.`;
    if (outputKey) {
      message = `The operation chain for the "${outputKey}" metric must contain at least one operation.`;
    }
    super(message);
    this.name = "OperationChainMustContainAtLeastOneOperation";
  }
}
export class OperationChainCantHaveAnyOperationAfterAnAggregationOperationError extends OperationChainError {
  constructor(outputKey?: string) {
    let message = `The operation chain can't have any operation after an aggregation operation.`;
    if (outputKey) {
      message = `The operation chain for the "${outputKey}" metric can't have any operation after an aggregation operation.`;
    }
    super(message);
    this.name =
      "OperationChainCantHaveAnyOperationAfterAnAggregationOperationError";
  }
}

export class AnalysisJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisJsonError";
  }
}

export class AnalysisJsonHasNoOutputsError extends AnalysisJsonError {
  constructor() {
    super(
      `Your analysis.json file has no outputs metrics. Please create a new metric before continuing.`
    );
    this.name = "AnalysisJsonHasNoOutputsError";
  }
}

export class AnalysisJsonHasUnusedOutputsWarning extends AnalysisJsonError {
  constructor(unusedOutputs: string[]) {
    super(
      `The following outputs are unused: "${unusedOutputs.join(
        ","
      )}". Please remove them or use them in a plot.`
    );
    this.name = "AnalysisJsonHasUnusedOutputsWarning";
  }
}

export class AnalysisJsonHasNoPlotsError extends AnalysisJsonError {
  constructor() {
    super(
      `Your analysis.json file has no plots. Please create a new plot before continuing.`
    );
    this.name = "AnalysisJsonHasNoOutputsError";
  }
}

export class PlotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlotError";
  }
}

export class PlotHasNoTitleError extends PlotError {
  constructor() {
    super(
      `The plot is either missing the required "title" property or it is an empty string.`
    );
    this.name = "PlotHasNoTitleError";
  }
}
export class PlotIsMissingLayoutComponentError extends PlotError {
  constructor(plotTitle: string, height?: string, width?: string) {
    const missingBoth = !height && !width;
    if (missingBoth) {
      super(
        `The plot titled "${plotTitle}" is missing the "height" and "width" properties. Valid values are percentage or pixels. Examples: "50%" or "200px".`
      );
    } else {
      super(
        `The plot titled "${plotTitle}" is missing the "${
          height ? "width" : "height"
        }" property.`
      );
    }
    this.name = "PlotIsMissingLayoutComponentError";
  }
}
export class PlotIsMissingPositionComponentError extends PlotError {
  constructor(plotTitle: string, x?: string, y?: string) {
    const missingBoth = !x && !y;
    if (missingBoth) {
      super(
        `The plot titled "${plotTitle}" is missing the "x" and "y" properties. Valid values are percentages. Example: "50%".`
      );
    } else {
      super(
        `The plot titled "${plotTitle}" is missing the "${
          x ? "y" : "x"
        }" property. Valid values are percentages. Example: "50%".`
      );
    }
    this.name = "PlotIsMissingPositionComponentError";
  }
}
export class PlotHasNoTypeError extends PlotError {
  constructor(plotTitle: string) {
    super(
      `The plot titled "${plotTitle}" does not have a "type" property. Valid values are "${getValidPlotTypes().join(
        ","
      )}".`
    );
    this.name = "PlotHasNoDataError";
  }
}
export class UnhandledPlotTypeError extends PlotError {
  constructor(plotTitle?: string, type?: string) {
    super(
      `The plot titled "${plotTitle}" has an invalid value (${type}) for the "type" property. Valid values are "${getValidPlotTypes().join(
        ","
      )}"`
    );
    this.name = "UnhandledPlotTypeError";
  }
}

export class PlotHasNoDataError extends PlotError {
  constructor(
    plotTitle: string,
    suggestedType?: "XDataPoints" | "YDataPoints" | "ZDataPoints"
  ) {
    if (suggestedType) {
      super(
        `The plot titled "${plotTitle}" is missing the required "data" property. It must follow the shape of "${suggestedType}"`
      );
    } else {
      // TODO: fix this message, not all of them need an array
      super(
        `The plot titled "${plotTitle}" is missing the required "data" property. Depending on the Plot Type, it must contain an array of either XDataPoints, YDataPoints or ZDataPoints.`
      );
    }
    this.name = "PlotHasNoDataError";
  }
}
export class PlotDataIsNotAnArrayError extends PlotError {
  constructor(
    plotTitle?: string,
    missingDataPointType?:
      | "XDataPoints"
      | "YDataPoints"
      | "ZDataPoints"
      | "XDataPoints or YDataPoints"
      | "XDataPoints and YDataPoints"
  ) {
    const message = plotTitle
      ? `The plot titled "${plotTitle}"`
      : "One of your plots";
    super(
      `${message} has an empty "data" property. It must contain an array of objects matching the shape of "${missingDataPointType}".`
    );
    this.name = "PlotDataIsNotAnArrayError";
  }
}

export class PlotDataIsNotAnArrayWarning extends PlotError {
  constructor(plotTitle?: string, providedValue?: any) {
    const message = plotTitle
      ? `The plot titled "${plotTitle}"`
      : "One of your plots";
    super(
      `${message} is using an incorrect type for the "data" property. It must contain an array of objects, but you provided "${typeof providedValue}".`
    );
    this.name = "PlotDataIsNotAnArrayWarning";
  }
}

export class PlotHasTheWrongTypeForYDataPointComponentError extends PlotError {
  constructor(plotTitle?: string, providedValue?: any) {
    let type = (typeof providedValue).toLowerCase();
    if (Array.isArray(providedValue)) {
      type = "array";
    }
    super(
      `The plot titled "${plotTitle}" is using an incorrect type for the "data.y" property. It must be a string, but you provided "${type}".`
    );
    this.name = "PlotHasTheWrongTypeForYDataPointsComponentError";
  }
}

export class PlotHasAnInvalidItemInTheDataArrayError extends PlotError {
  constructor(
    plotTitle: string,
    missingDataPointType?:
      | "XDataPoints"
      | "YDataPoints"
      | "ZDataPoints"
      | "XDataPoints or YDataPoints"
      | "XDataPoints and YDataPoints"
  ) {
    super(
      `The plot titled "${plotTitle}" has an invalid type inside of the "data" array. Items must be an object${
        missingDataPointType
          ? `, following the shape of "${missingDataPointType}"`
          : ""
      }.`
    );
    this.name = "PlotHasAnInvalidItemInTheDataArrayError";
  }
}

export class PlotHasEmptyDataError extends PlotError {
  constructor(
    plotTitle: string,
    missingDataPointType?:
      | "XDataPoints"
      | "YDataPoints"
      | "ZDataPoints"
      | "XDataPoints or YDataPoints"
      | "XDataPoints and YDataPoints"
  ) {
    super(
      `The plot titled "${plotTitle}" has an empty array for the "data" property. It must have at least one item${
        missingDataPointType
          ? `. Following the shape of "${missingDataPointType}"`
          : ""
      }.`
    );
    this.name = "PlotHasEmptyDataError";
  }
}

export class PlotHasEmptyDataObjectError extends PlotError {
  constructor(
    plotTitle: string,
    missingDataPointType?:
      | "XDataPoints"
      | "YDataPoints"
      | "ZDataPoints"
      | "XDataPoints or YDataPoints"
      | "XDataPoints and YDataPoints"
  ) {
    super(
      `The plot titled "${plotTitle}" has an empty object in the "data" property${
        missingDataPointType
          ? `. It must follow the shape of "${missingDataPointType}"`
          : ""
      }.`
    );
    this.name = "PlotHasEmptyDataObjectError";
  }
}

export class PlotIsReferencingNonExistingOutputError extends PlotError {
  constructor(
    plotTitle?: string,
    xyz?: "x" | "y" | "z",
    invalidOutput?: string,
    closestMatch?: string
  ) {
    const closestMatchStr = closestMatch
      ? ` Did you mean "${closestMatch}"?.`
      : "";
    super(
      `The plot titled "${plotTitle}" is referencing an non-existing output metric titled "${invalidOutput}" inside of the "data.${xyz}" property.${closestMatchStr}`
    );
    this.name = "PlotIsReferencingNonExistingOutput";
  }
}
export class PlotIsMissingXDataPointComponentError extends PlotError {
  constructor(plotTitle: string) {
    super(
      `The plot titled "${plotTitle}" is missing the "data.x" property, which must be of type "string".`
    );
    this.name = "PlotIsMissingXDataPointComponent";
  }
}
export class PlotIsMissingXDataPointsComponentError extends PlotError {
  constructor(plotTitle: string) {
    super(
      `The plot titled "${plotTitle}" is missing the "data.x" property, which must be of type "string" or "string[]".`
    );
    this.name = "PlotIsMissingXDataPointsComponent";
  }
}
export class PlotIsMissingYDataPointsComponentError extends PlotError {
  constructor(plotTitle?: string, allowArrayOfStrings = false) {
    const type = allowArrayOfStrings ? '"string" or "string[]"' : '"string"';
    super(
      `The plot titled "${plotTitle}" is missing the "data.y" property, which must be of type ${type}.`
    );
    this.name = "PlotIsMissingYDataPointsComponentError";
  }
}

export class PlotIsMissingYAndXDataPointsComponentError extends PlotError {
  constructor(plotTitle?: string, allowArrayOfStrings = false) {
    const type = allowArrayOfStrings ? '"string" or "string[]"' : '"string"';
    super(
      `The plot titled "${plotTitle}" is missing both "data.x" and "data.y" properties, though only one can be used at a time. The value must be of type ${type}.`
    );
    this.name = "PlotIsMissingYAndXDataPointsComponentError";
  }
}

export class PlotIsMissingYAndOptionallyXDataPointsComponentError extends PlotError {
  constructor(plotTitle?: string) {
    super(
      `The plot titled "${plotTitle}" is missing both "data.y" and, optionally "data.x" properties. The value must be of type "string[]".`
    );
    this.name = "PlotIsMissingYAndOptionallyXDataPointsComponentError ";
  }
}

export class PlotLineOrScatterDoesNotSupportNameError extends PlotError {
  constructor(plotTitle?: string) {
    // TODO: add support for xName and yName as suggested on https://hashintel.slack.com/archives/CFWAZPACR/p1614248621051400?thread_ts=1614201445.048400&cid=CFWAZPACR
    super(
      `The plot titled "${plotTitle}" contains the property "name" which is not supported for Line or Scatter plots. Please remove it to fix this error.`
    );
    this.name = "PlotIsMissingYAndOptionallyXDataPointsComponentError ";
  }
}

export class PlotLineOrScatterBothAxesMustBeInSyncError extends PlotError {
  constructor(plotTitle?: string) {
    // TODO: confirm if this is what Ciaran meant
    super(
      `The plot titled "${plotTitle}" is using an output metric that ends in a "get" operation, but the "data.x" and "data.y" properties are not in sync. Please make sure both match to fix this error.`
    );
    this.name = "PlotLineOrScatterBothAxesMustBeInSyncError";
  }
}

// TODO: PlotIsMissingZDataPointsComponent

export class PlotHasExtraDataFieldsError extends PlotError {
  constructor(
    plotTitle?: string,
    expectedShape?:
      | "XDataPoints"
      | "YDataPoints"
      | "ZDataPoints"
      | "XDataPoints or YDataPoints"
  ) {
    let message = `${
      plotTitle ? `The plot titled "${plotTitle}"` : "One of your plots"
    } has extra fields under the "data" property.`;
    if (expectedShape) {
      message = `${message} The shape of this object must match "${expectedShape}".`;
    }
    super(message);
    this.name = "PlotHasExtraDataFields";
  }
}

export class PlotHasTheWrongKindOfDataError extends PlotError {
  constructor(
    plotTitle?: string,
    expectedShape?:
      | "XDataPoints"
      | "YDataPoints"
      | "ZDataPoints"
      | "XDataPoints or YDataPoints",
    currentPlotData?:
      | XDataPoint
      | YDataPoint
      | YDataPoints
      | ZDataPoints
      | XDataPoint[]
      | YDataPoint[]
      | ZDataPoints[]
  ) {
    let providedShape = "XDataPoints";
    if ((currentPlotData as YDataPoint).y) {
      providedShape = "YDataPoints";
    }
    if ((currentPlotData as ZDataPoints).z) {
      providedShape = "ZDataPoints";
    }
    const message = plotTitle
      ? `The plot titled "${plotTitle}"`
      : "One of your plots";
    super(
      `${message} is using an incorrect shape for the "data" property. It is expecting "${expectedShape}" but you provided "${providedShape}"`
    );
    this.name = "PlotHasTheWrongKindOfDataError";
  }
}

export class PlotUsedOutputMustEndInAggregationOperationError extends PlotError {
  constructor(plotTitle?: string, outputName?: string) {
    super(
      `The plot titled "${plotTitle}" is referencing the output "${outputName}" which does not end in an Aggregation Operation. Valid values are "max, min, mean, sum, count".`
    );
    this.name = "PlotUsedOutputMustEndInAggregationOperationError";
  }
}
