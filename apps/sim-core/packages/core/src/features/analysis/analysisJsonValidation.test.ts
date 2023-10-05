// @ts-nocheck
import {
  AggregatorOperator,
  AnalysisJson,
  CountOperator,
  CumulativeAggregateOperator,
  FilterComparator,
  FilterOperator,
  GetOperator,
  OutputOperation,
} from "./analysisJsonTypes";
import {
  AnalysisJsonError,
  AnalysisJsonHasNoOutputsError,
  AnalysisJsonHasUnusedOutputsWarning,
  OperationChainCantHaveAnyOperationAfterAnAggregationOperationError,
  OperationChainError,
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
  PlotDataIsNotAnArrayError,
  PlotError,
  PlotHasEmptyDataObjectError,
  PlotHasExtraDataFieldsError,
  PlotHasNoDataError,
  PlotHasNoTitleError,
  PlotHasNoTypeError,
  PlotHasTheWrongKindOfDataError,
  PlotHasTheWrongTypeForYDataPointComponentError,
  PlotIsMissingLayoutComponentError,
  PlotIsMissingPositionComponentError,
  PlotIsMissingYAndXDataPointsComponentError,
  PlotIsMissingYDataPointsComponentError,
  PlotIsReferencingNonExistingOutputError,
  PlotUsedOutputMustEndInAggregationOperationError,
  UnhandledOutputOperationError,
  UnhandledPlotTypeError,
} from "./errors";
import { getValidPlotTypes } from "./utils";
import {
  validateAnalysisJson,
  validateOutput,
  validateOutputOperation,
  validatePlot,
} from "./analysisJsonValidation";

// TODO: check that the `error.name` is set correctly

const expectErrorToBe = (error: any, parentErrorType: any, errorType: any) => {
  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(parentErrorType);
  expect(error).toBeInstanceOf(errorType);
};

const expectErrorToBeAndContain = (
  error: any,
  parentErrorType: any,
  errorType: any,
  messageShouldContain: string
) => {
  expectErrorToBe(error, parentErrorType, errorType);
  expect(error.message).toContain(messageShouldContain);
};

const expectErrorToMatchExactly = (
  error: any,
  parentErrorType: any,
  errorType: any,
  messageShouldBe: string
) => {
  expectErrorToBe(error, parentErrorType, errorType);
  expect(error.message).toBe(messageShouldBe);
};

describe("validateOutputOperation", () => {
  // No op field
  test("Throws OutputOperationIsMissingOperationError", () => {
    const error = validateOutputOperation({ op: false });
    expectErrorToBe(
      error,
      OutputOperationError,
      OutputOperationIsMissingOperationError
    );
  });

  // Op field contains invalid values
  test("Throws UnhandledOutputOperationError", () => {
    const error = validateOutputOperation({ op: "teleport" });
    expectErrorToBe(error, OutputOperationError, UnhandledOutputOperationError);
  });

  // Operation contains extra fields
  const singleOps = [
    AggregatorOperator.max,
    AggregatorOperator.min,
    AggregatorOperator.mean,
    AggregatorOperator.sum,
    CountOperator.count,
  ];
  test.each(singleOps)(
    "AggregationOperations+CountOperation: Throws OutputOperationHasExtraFieldsError when having extra fields and using the operation '%s'",
    (operationName) => {
      const error = validateOutputOperation({
        op: operationName,
        invalidField: "yes",
        withMustard: true,
      });
      expectErrorToBe(
        error,
        OutputOperationError,
        OutputOperationHasExtraFieldsError
      );
    }
  );

  test.each(singleOps)(
    "AggregationOperations+CountOperation: success case for '%s'",
    (operationName) =>
      expect(
        validateOutputOperation({
          op: operationName,
        })
      ).toBe(true)
  );

  // Operation is missing required fields (by)
  test("AggregateOperationEnum.aggregate: Throws OutputOperationIsMissingRequiredFieldsError (missing by parameter)", () => {
    const error = validateOutputOperation({
      op: CumulativeAggregateOperator.aggregate,
    });
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationIsMissingRequiredFieldsError,
      '"by"'
    ); // "by" is the field that is missing
  });

  // the "by" field contains invalid values
  test("AggregateOperationEnum.aggregate: Throws OutputOperationHasInvalidValuesError", () => {
    const error = validateOutputOperation({
      op: CumulativeAggregateOperator.aggregate,
      by: "super invalid by field",
    });
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationHasInvalidValuesError,
      '"by"'
    ); // "by" is the field that is missing
  });

  // the "range" field contains invalid values
  test("AggregateOperationEnum.aggregate -> Throws OutputOperationMustBeANumberError", () => {
    const error = validateOutputOperation({
      op: CumulativeAggregateOperator.aggregate,
      by: AggregatorOperator.sum,
      range: "spaghetti alla bologneses",
    });
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationMustBeANumberError,
      "range"
    ); // "range" is the field that has incorrect values
  });

  test("AggregateOperationEnum.aggregate -> success case", () =>
    expect(
      validateOutputOperation({
        op: CumulativeAggregateOperator.aggregate,
        by: AggregatorOperator.sum,
      })
    ).toBe(true));

  // the fields "field", "comparison" and "value" must be present
  test.each(["field", "comparison", "value"])(
    'Filter: Throws OutputOperationIsMissingRequiredFieldsError when missing the field "%s"',
    (fieldName) => {
      const params: any = {
        op: FilterOperator.filter,
      };
      params[fieldName] = "orecchia di elefante";
      const error = validateOutputOperation(params);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(OutputOperationError);
      expect(error).toBeInstanceOf(OutputOperationIsMissingRequiredFieldsError);
      expect(error.message).not.toContain(`"${fieldName}"`);
    }
  );

  // we must not have extra fields
  test("Filter: Throws OutputOperationHasExtraFieldsError", () => {
    const error = validateOutputOperation({
      op: FilterOperator.filter,
      field: "age",
      comparison: FilterComparator.eq,
      value: 5,
      iAmAnExtraField: "what am i doing here",
    });
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationHasExtraFieldsError,
      "iAmAnExtraField"
    );
  });

  // "field" must be a number or a string
  test("Filter: Throws OutputOperationMustBeANumberOrStringError", () => {
    const error = validateOutputOperation({
      op: FilterOperator.filter,
      field: [],
      comparison: FilterComparator.eq,
      value: 5,
    });
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationMustBeANumberOrStringError,
      '"field"'
    );
  });

  // "comparison" must be a valid comparison operator
  test("Filter: Throws OutputOperationHasInvalidValuesError (comparison field)", () => {
    const error = validateOutputOperation({
      op: FilterOperator.filter,
      field: "age",
      comparison: "looksLike",
      value: 5,
    });
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationHasInvalidValuesError,
      "comparison"
    );
    // should also show all the valid values
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationHasInvalidValuesError,
      FilterComparator.eq
    );
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationHasInvalidValuesError,
      FilterComparator.neq
    );
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationHasInvalidValuesError,
      FilterComparator.gt
    );
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationHasInvalidValuesError,
      FilterComparator.gte
    );
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationHasInvalidValuesError,
      FilterComparator.lt
    );
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationHasInvalidValuesError,
      FilterComparator.lte
    );
  });

  // "value" must not be complex
  test("Filter: Throws OutputOperationHasComplexValuesError (value field)", () => {
    const error = validateOutputOperation({
      op: FilterOperator.filter,
      field: "age",
      comparison: FilterComparator.gte,
      value: () => {},
    });
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationHasComplexValuesError,
      "value"
    );
    // should show valid values
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationHasComplexValuesError,
      "string"
    );
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationHasComplexValuesError,
      "string[]"
    );
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationHasComplexValuesError,
      "number"
    );
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationHasComplexValuesError,
      "number[]"
    );
  });

  test("Filter: Throws OutputOperationGetBooleanFilterIsUsingWrongComparisonError", () => {
    const error = validateOutputOperation({
      op: FilterOperator.filter,
      field: "age",
      comparison: FilterComparator.gte,
      value: true,
    });
    const message = `The operation "filter" is using an invalid comparison operator. You provided "${FilterComparator.gte}", while valid values are "eq" and "neq".`;
    expectErrorToMatchExactly(
      error,
      OutputOperationError,
      OutputOperationGetBooleanFilterIsUsingWrongComparisonError,
      message
    );
  });

  // - "filter" on a non-any typed field must have a value of the same type
  test.todo(
    "Filter: Throws OutputOperationFilterMustBeTheSameTypeAsTheValue. Missing implementation until we pass the Behavior Keys to this method"
  );
  test("Filter: success case", () =>
    expect(
      validateOutputOperation({
        op: FilterOperator.filter,
        field: "age",
        comparison: FilterComparator.gte,
        value: 5,
      })
    ).toBe(true));

  test("Get: Throws OutputOperationIsMissingRequiredFieldsError (missing 'field' parameter)", () => {
    const error = validateOutputOperation({
      op: GetOperator.get,
    });
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationIsMissingRequiredFieldsError,
      '"field"'
    ); // "field" is the field that is missing
  });

  test("Get: Throws OutputOperationHasExtraFieldsError", () => {
    const error = validateOutputOperation({
      op: GetOperator.get,
      field: "age",
      iAmAnExtraField: "pizza bianca",
    });
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationHasExtraFieldsError,
      "iAmAnExtraField"
    ); // "IAmAnExtraField" is the field that shouldn't be there
  });

  test("Get: Throws OutputOperationMustBeANumberOrStringError (field)", () => {
    const error = validateOutputOperation({
      op: GetOperator.get,
      field: [],
    });
    expectErrorToBeAndContain(
      error,
      OutputOperationError,
      OutputOperationMustBeANumberOrStringError,
      "field"
    ); // "field" is the field that has wrong values
  });

  test("Get: success case", () => {
    expect(
      validateOutputOperation({
        op: GetOperator.get,
        field: "age",
      })
    ).toBe(true);
  });
});

describe("validateOutput", () => {
  test("returns OperationChainMustBeAnArrayError", () => {
    const chain = {};
    const error = validateOutput(chain);
    expectErrorToMatchExactly(
      error,
      OperationChainError,
      OperationChainMustBeAnArrayError,
      'The operation chain must be an array. You provided "object".'
    );
  });

  test("fails if the chain is empty", () => {
    const chain: OutputOperation[] = [];
    const error = validateOutput(chain) as OperationChainError[];
    expectErrorToMatchExactly(
      error,
      OperationChainError,
      OperationChainMustContainAtLeastOneOperationError,
      "The operation chain must contain at least one operation."
    );
  });

  test("returns OperationChainCantHaveAnyOperationAfterAnAggregationOperationError ", () => {
    const chain = [
      { op: GetOperator.get, field: "age" },
      { op: AggregatorOperator.max },
      { op: GetOperator.get, field: "age" }, // <-- this one is invalid
    ];
    const error = validateOutput(chain);
    expectErrorToMatchExactly(
      error,
      OperationChainError,
      OperationChainCantHaveAnyOperationAfterAnAggregationOperationError,
      "The operation chain can't have any operation after an aggregation operation."
    );
  });

  test("returns OperationChainCantHaveAnyOperationAfterAnAggregationOperationError with affected output", () => {
    const chain = [
      { op: GetOperator.get, field: "age" },
      { op: AggregatorOperator.max },
      { op: GetOperator.get, field: "age" }, // <-- this one is invalid
    ];
    const error = validateOutput(chain, "outputKeyNameGoesHere");
    expectErrorToMatchExactly(
      error,
      OperationChainError,
      OperationChainCantHaveAnyOperationAfterAnAggregationOperationError,
      `The operation chain for the "outputKeyNameGoesHere" metric can't have any operation after an aggregation operation.`
    );
  });

  test("get: fails if the first time we run it is not a string (negative integer case)", () => {
    const chain: OutputOperation[] = [{ op: GetOperator.get, field: -5 }];
    const error = validateOutput(chain) as OperationChainError[];
    expectErrorToMatchExactly(
      error,
      OperationChainError,
      OperationChainFirstGetFieldMustBeAStringError,
      'Your first "get" operation must access the "field" using a string.'
    );
  });

  test("get: fails if the first time we run it is not a string (positive integer case)", () => {
    const chain: OutputOperation[] = [{ op: GetOperator.get, field: 5 }];
    const error = validateOutput(chain) as OperationChainError[];
    expectErrorToMatchExactly(
      error,
      OperationChainError,
      OperationChainFirstGetFieldMustBeAStringError,
      'Your first "get" operation must access the "field" using a string.'
    );
  });

  test("get: fails if the first time we run it is not a string (boolean case)", () => {
    const chain: OutputOperation[] = [{ op: GetOperator.get, field: true }];
    const error = validateOutput(chain) as OperationChainError[];
    expectErrorToMatchExactly(
      error,
      OperationChainError,
      OperationChainFirstGetFieldMustBeAStringError,
      'Your first "get" operation must access the "field" using a string.'
    );
  });

  test("get: fails if the first operation is an aggregation operation", () => {
    const chain: OutputOperation[] = [
      {
        op: AggregatorOperator.sum,
      },
    ];
    const error = validateOutput(chain) as OperationChainError[];
    const message =
      'The first operation in the chain cannot be an Aggregation operation. Valid values are "aggregate,count,filter,get".';
    expectErrorToMatchExactly(
      error,
      OperationChainError,
      OperationChainFirstOperationCanNotBeAnAggregationError,
      message
    );
  });

  test("get: success case", () => {
    const chain: OutputOperation[] = [
      {
        op: GetOperator.get,
        field: "age",
      },
    ];
    expect(validateOutput(chain)).toBe(true);
  });
});

describe("validateAnalysisJson", () => {
  test("returns AnalysisJsonHasNoOutputsError", () => {
    const outputs: any = {};
    const plots: any = [
      {
        title: "this is the plot title",
        type: "bar",
        data: {
          x: "feature_1",
        },
      },
    ];
    const parsedJson: AnalysisJson = { outputs, plots };
    const errors = validateAnalysisJson(parsedJson).errors;
    const message = `Your analysis.json file has no outputs metrics. Please create a new metric before continuing.`;
    expect(errors.length).toBe(1);
    expectErrorToMatchExactly(
      errors[0],
      AnalysisJsonError,
      AnalysisJsonHasNoOutputsError,
      message
    );
  });

  test("returns UnusedOutputsWarning", () => {
    const outputs: any = {
      feature_1: {
        op: GetOperator.get,
        field: "age",
      },
      feature_2: {
        op: GetOperator.get,
        field: "age",
      },
    };
    const plots: any = [
      {
        title: "this is the plot title",
        type: "bar",
        data: {
          x: "feature_1",
        },
      },
    ];
    const parsedJson: AnalysisJson = { outputs, plots };
    const errors = validateAnalysisJson(parsedJson).warnings;
    const unusedOutputs = ["feature_2"];
    const message = `The following outputs are unused: "${unusedOutputs.join(
      ","
    )}". Please remove them or use them in a plot.`;
    expect(errors.length).toBeGreaterThan(0);
    expectErrorToMatchExactly(
      errors[0],
      AnalysisJsonError,
      AnalysisJsonHasUnusedOutputsWarning,
      message
    );
  });

  test("returns outputValidationErrors", () => {
    const outputs: any = {
      feature_1: {
        op: GetOperator.get,
        field: "a",
      },
    };
    const plots: any = [
      {
        title: "this is the plot title",
        type: "bar",
        data: {
          x: "feature_1",
        },
      },
    ];
    const parsedJson: AnalysisJson = { outputs, plots };
    const errors = validateAnalysisJson(parsedJson).errors as Error[];
    const message = `The operation chain for the "feature_1" metric must be an array. You provided "object".`;
    expect(errors.length).toBe(1);
    expectErrorToMatchExactly(
      errors[0],
      OperationChainError,
      OperationChainMustBeAnArrayError,
      message
    );
  });

  test("returns plotValidationErrors", () => {
    const outputs: any = {
      feature_1: [
        {
          op: "filter",
          field: "color",
          comparison: "eq",
          value: "green",
        },
        {
          op: "count",
        },
      ],
    };
    const plots: any = [
      {
        type: "box",
        data: {
          y: ["feature_1"],
        },
      },
    ];
    const parsedJson: AnalysisJson = { outputs, plots };
    const errors = validateAnalysisJson(parsedJson).errors as Error[];
    const message =
      'The plot is either missing the required "title" property or it is an empty string.';
    expect(errors.length).toBe(1);
    expectErrorToMatchExactly(
      errors[0],
      PlotError,
      PlotHasNoTitleError,
      message
    );
  });

  test("success case", () => {
    const outputs: any = {
      feature_1: [
        {
          op: "filter",
          field: "color",
          comparison: "eq",
          value: "green",
        },
        {
          op: "count",
        },
      ],
    };
    const plots: any = [
      {
        title: "Shop Status",
        timeseries: ["feature_1"],
      },
    ];
    expect(validateAnalysisJson({ outputs, plots }).success).toBe(true);
  });
});

describe("validatePlot", () => {
  const title = "The Plot Title";
  const defaultOutputs = {
    test: [
      { op: GetOperator.get, field: "age " },
      { op: GetOperator.get, field: "age " },
    ],
    test2: [
      {
        op: FilterOperator.filter,
        field: "age",
        comparison: FilterComparator.eq,
        value: 5,
      },
      { op: GetOperator.get, field: "age " },
    ],
  };
  test("returns PlotHasNoTitleError", () => {
    const error = validatePlot({}, defaultOutputs);
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasNoTitleError,
      `The plot is either missing the required "title" property or it is an empty string.`
    );
  });

  test("returns PlotIsMissingLayoutComponentError (missing both)", () => {
    const error = validatePlot({ title, layout: {} }, defaultOutputs);
    const message = `The plot titled "${title}" is missing the "height" and "width" properties. Valid values are percentage or pixels. Examples: "50%" or "200px".`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsMissingLayoutComponentError,
      message
    );
  });

  test("returns PlotIsMissingLayoutComponentError (missing height)", () => {
    const error = validatePlot(
      { title, layout: { width: "100%" } },
      defaultOutputs
    );
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsMissingLayoutComponentError,
      `The plot titled "${title}" is missing the "height" property.`
    );
  });

  test("returns PlotIsMissingLayoutComponentError (missing width)", () => {
    const error = validatePlot(
      { title, layout: { height: "100%" } },
      defaultOutputs
    );
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsMissingLayoutComponentError,
      `The plot titled "${title}" is missing the "width" property.`
    );
  });

  test("returns PlotIsMissingPositionComponentError (missing both)", () => {
    const error = validatePlot({ title, position: {} }, defaultOutputs);
    const message = `The plot titled "${title}" is missing the "x" and "y" properties. Valid values are percentages. Example: "50%".`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsMissingPositionComponentError,
      message
    );
  });

  test("returns PlotIsMissingPositionComponentError (missing x)", () => {
    const error = validatePlot(
      { title, position: { y: "50%" } },
      defaultOutputs
    );
    const message = `The plot titled "${title}" is missing the "x" property. Valid values are percentages. Example: "50%".`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsMissingPositionComponentError,
      message
    );
  });

  test("returns PlotIsMissingPositionComponentError (missing y)", () => {
    const error = validatePlot(
      { title, position: { x: "50%" } },
      defaultOutputs
    );
    const message = `The plot titled "${title}" is missing the "y" property. Valid values are percentages. Example: "50%".`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsMissingPositionComponentError,
      message
    );
  });

  test("returns PlotHasNoTypeError", () => {
    const error = validatePlot({ title }, defaultOutputs);
    const message = `The plot titled "${title}" does not have a "type" property. Valid values are "${getValidPlotTypes().join(
      ","
    )}".`;
    expectErrorToMatchExactly(error, PlotError, PlotHasNoTypeError, message);
  });

  test("returns UnhandledPlotTypeError", () => {
    const error = validatePlot(
      { title, type: "super invalid type right here" },
      defaultOutputs
    );
    const message = `The plot titled "${title}" has an invalid value (super invalid type right here) for the "type" property. Valid values are "${getValidPlotTypes().join(
      ","
    )}"`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      UnhandledPlotTypeError,
      message
    );
  });

  test("returns PlotHasNoDataError", () => {
    const error = validatePlot({ title, type: "box" }, defaultOutputs);
    const message = `The plot titled "${title}" is missing the required "data" property. Depending on the Plot Type, it must contain an array of either XDataPoints, YDataPoints or ZDataPoints.`;
    expectErrorToMatchExactly(error, PlotError, PlotHasNoDataError, message);
  });

  test("Plot type: bar -> Throws PlotHasEmptyDataObjectError", () => {
    const error = validatePlot(
      {
        title,
        type: "bar",
        data: {},
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" has an empty object in the "data" property.`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasEmptyDataObjectError,
      message
    );
  });

  test("Plot type: bar -> Throws PlotHasExtraDataFields", () => {
    const error = validatePlot(
      {
        title,
        type: "bar",
        data: [
          {
            y: "a",
            name: "a",
            extraProperty: "that shouldnt exist",
          },
        ],
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" has extra fields under the "data" property. The shape of this object must match "YDataPoints".`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasExtraDataFieldsError,
      message
    );
  });

  test("Plot type: bar -> Throws PlotHasTheWrongKindOfDataError (XDataPoints case)", () => {
    const error = validatePlot(
      {
        title,
        type: "bar",
        data: [
          {
            x: "mean",
            name: "mean",
          },
        ],
      },
      {
        mean: [
          { op: GetOperator.get, field: "a" },
          { op: AggregatorOperator.mean },
        ],
      }
    );
    const message = `The plot titled "${title}" is using an incorrect shape for the "data" property. It is expecting "YDataPoints" but you provided "XDataPoints"`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasTheWrongKindOfDataError,
      message
    );
  });

  test("Plot type: bar -> Throws PlotHasTheWrongKindOfDataError (ZDataPoints case)", () => {
    const error = validatePlot(
      {
        title,
        type: "bar",
        data: [
          {
            z: "a",
            name: "a",
          },
        ],
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" is using an incorrect shape for the "data" property. It is expecting "YDataPoints" but you provided "ZDataPoints"`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasTheWrongKindOfDataError,
      message
    );
  });

  test("Plot type: bar -> Throws PlotIsMissingYDataPointsComponentError", () => {
    const error = validatePlot(
      {
        title,
        type: "bar",
        data: [
          {
            name: "a",
          },
        ],
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" is missing the "data.y" property, which must be of type "string".`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsMissingYDataPointsComponentError,
      message
    );
  });

  test("Plot type: bar -> Throws PlotIsReferencingNonExistingOutputError (no suggestion)", () => {
    const error = validatePlot(
      {
        title,
        type: "bar",
        data: {
          y: "a",
          name: "a",
        },
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" is referencing an non-existing output metric titled "a" inside of the "data.y" property.`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsReferencingNonExistingOutputError,
      message
    );
  });

  test("Plot type: bar -> Throws PlotHasTheWrongTypeForYDataPointComponentError", () => {
    const error = validatePlot(
      {
        title,
        type: "bar",
        data: {
          y: ["hello"],
          name: ["hello"],
        },
      },
      {
        hello: [
          { op: GetOperator.get, field: "age " },
          { op: GetOperator.get, field: "age " },
        ],
        nothingLikeThePreviousOnes: [
          {
            op: FilterOperator.filter,
            field: "age",
            comparison: FilterComparator.eq,
            value: 5,
          },
          { op: GetOperator.get, field: "age " },
        ],
      }
    );

    const message = `The plot titled "${title}" is using an incorrect type for the "data.y" property. It must be a string, but you provided "array".`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasTheWrongTypeForYDataPointComponentError,
      message
    );
  });

  test("Plot type: bar -> Throws PlotIsReferencingNonExistingOutputError (suggestion)", () => {
    const error = validatePlot(
      {
        title,
        type: "bar",
        data: [
          {
            y: "hellu",
            name: "a",
          },
        ],
      },
      {
        hello: [
          { op: GetOperator.get, field: "age " },
          { op: GetOperator.get, field: "age " },
        ],
        nothingLikeThePreviousOnes: [
          {
            op: FilterOperator.filter,
            field: "age",
            comparison: FilterComparator.eq,
            value: 5,
          },
          { op: GetOperator.get, field: "age " },
        ],
      }
    );
    const message = `The plot titled "${title}" is referencing an non-existing output metric titled "hellu" inside of the "data.y" property. Did you mean "hello"?.`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsReferencingNonExistingOutputError,
      message
    );
  });

  test("Plot type: bar -> Throws PlotIsReferencingNonExistingOutputError (no suggestion)", () => {
    const error = validatePlot(
      {
        title,
        type: "bar",
        data: [
          {
            y: "arkansas",
            name: "a",
          },
        ],
      },
      {
        hello: [
          { op: GetOperator.get, field: "age " },
          { op: GetOperator.get, field: "age " },
        ],
        nothingLikeThePreviousOnes: [
          {
            op: FilterOperator.filter,
            field: "age",
            comparison: FilterComparator.eq,
            value: 5,
          },
          { op: GetOperator.get, field: "age " },
        ],
      }
    );
    const message = `The plot titled "${title}" is referencing an non-existing output metric titled "arkansas" inside of the "data.y" property.`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsReferencingNonExistingOutputError,
      message
    );
  });

  test("Plot type: bar -> Throws PlotBarChartUsedOutputMustEndInAggregationOperationError", () => {
    const error = validatePlot(
      {
        title,
        type: "bar",
        data: [
          {
            y: "hello",
            name: "hello",
          },
        ],
      },
      {
        hello: [{ op: GetOperator.get, field: "age " }],
        nothingLikeThePreviousOnes: [
          {
            op: FilterOperator.filter,
            field: "age",
            comparison: FilterComparator.eq,
            value: 5,
          },
          { op: GetOperator.get, field: "age " },
        ],
      }
    );

    const message = `The plot titled "${title}" is referencing the output "hello" which does not end in an Aggregation Operation. Valid values are "max, min, mean, sum, count".`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotUsedOutputMustEndInAggregationOperationError,
      message
    );
  });

  test("Plot type: box -> Throws PlotHasEmptyDataObjectError", () => {
    const error = validatePlot(
      {
        title,
        type: "box",
        data: {},
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" has an empty object in the "data" property.`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasEmptyDataObjectError,
      message
    );
  });

  test("Plot type: box -> Throws PlotHasExtraDataFields", () => {
    const error = validatePlot(
      {
        title,
        type: "box",
        data: {
          y: "a",
          name: "a",
          extraProperty: "that shouldnt exist",
        },
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" has extra fields under the "data" property. The shape of this object must match "YDataPoints".`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasExtraDataFieldsError,
      message
    );
  });

  test("Plot type: box -> Throws PlotHasTheWrongKindOfDataError (XDataPoints case)", () => {
    const error = validatePlot(
      {
        title,
        type: "box",
        data: {
          x: "a",
          name: "a",
        },
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" is using an incorrect shape for the "data" property. It is expecting "YDataPoints" but you provided "XDataPoints"`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasTheWrongKindOfDataError,
      message
    );
  });

  test("Plot type: box -> Throws PlotHasTheWrongKindOfDataError (ZDataPoints case)", () => {
    const error = validatePlot(
      {
        title,
        type: "box",
        data: {
          z: "a",
          name: "a",
        },
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" is using an incorrect shape for the "data" property. It is expecting "YDataPoints" but you provided "ZDataPoints"`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasTheWrongKindOfDataError,
      message
    );
  });

  test("Plot type: box -> Throws PlotIsMissingYDataPointsComponent", () => {
    const error = validatePlot(
      {
        title,
        type: "box",
        data: {
          name: "a",
        },
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" is missing the "data.y" property, which must be of type "string".`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsMissingYDataPointsComponentError,
      message
    );
  });

  test("Plot type: box -> Throws PlotIsReferencingNonExistingOutput (no suggestion)", () => {
    const error = validatePlot(
      {
        title,
        type: "box",
        data: {
          y: "a",
          name: "a",
        },
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" is referencing an non-existing output metric titled "a" inside of the "data.y" property.`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsReferencingNonExistingOutputError,
      message
    );
  });

  test("Plot type: box -> Throws PlotIsReferencingNonExistingOutput (suggestion)", () => {
    const error = validatePlot(
      {
        title,
        type: "box",
        data: {
          y: "hellu",
          name: "a",
        },
      },
      {
        hello: [
          { op: GetOperator.get, field: "age " },
          { op: GetOperator.get, field: "age " },
        ],
        nothingLikeThePreviousOnes: [
          {
            op: FilterOperator.filter,
            field: "age",
            comparison: FilterComparator.eq,
            value: 5,
          },
          { op: GetOperator.get, field: "age " },
        ],
      }
    );
    const message = `The plot titled "${title}" is referencing an non-existing output metric titled "hellu" inside of the "data.y" property. Did you mean "hello"?.`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsReferencingNonExistingOutputError,
      message
    );
  });

  // FIXME: These tests are disabled since we still don't support them.
  const TwoParameterExperimentTypes = [
    "contour",
    "heatmap",
    "line3d",
    "scatter3d",
  ];
  test.skip.each(TwoParameterExperimentTypes)(
    "Plot type: %s -> Throws PlotDataIsNotAnArrayError",
    (type: any) => {
      const error = validatePlot(
        {
          title,
          type,
          data: {},
        },
        defaultOutputs
      );
      const message = `The plot titled "${title}" has an empty "data" property. It must contain an array of objects matching the shape of "ZDataPoints".`;
      expectErrorToMatchExactly(
        error,
        PlotError,
        PlotDataIsNotAnArrayError,
        message
      );
    }
  );
  test.skip.each(TwoParameterExperimentTypes)(
    "Plot type: %s -> Throws PlotHasExtraDataFields",
    (type: any) => {
      const error = validatePlot(
        {
          title,
          type,
          data: {
            z: "test",
            extraProp: true,
          },
        },
        defaultOutputs
      );
      const message = `The plot titled "${title}" has extra fields under the "data" property. The shape of this object must match "ZDataPoints".`;
      expectErrorToMatchExactly(
        error,
        PlotError,
        PlotHasExtraDataFieldsError,
        message
      );
    }
  );

  test.skip.each(TwoParameterExperimentTypes)(
    "Plot type: %s -> Throws PlotHasTheWrongKindOfDataError (XDataPoints example)",
    (type: any) => {
      const error = validatePlot(
        {
          title,
          type,
          data: {
            x: "test",
          },
        },
        defaultOutputs
      );
      const message = `The plot titled "${title}" is using an incorrect shape for the "data" property. It is expecting "ZDataPoints" but you provided "XDataPoints"`;
      expectErrorToMatchExactly(
        error,
        PlotError,
        PlotHasTheWrongKindOfDataError,
        message
      );
    }
  );

  test.skip.each(TwoParameterExperimentTypes)(
    "Plot type: %s -> Throws PlotHasTheWrongKindOfDataError (YDataPoints example)",
    (type: any) => {
      const error = validatePlot(
        {
          title,
          type,
          data: {
            y: "test",
          },
        },
        defaultOutputs
      );
      const message = `The plot titled "${title}" is using an incorrect shape for the "data" property. It is expecting "ZDataPoints" but you provided "YDataPoints"`;
      expectErrorToMatchExactly(
        error,
        PlotError,
        PlotHasTheWrongKindOfDataError,
        message
      );
    }
  );

  test.skip.each(TwoParameterExperimentTypes)(
    "Plot type: %s -> Throws PlotIsReferencingNonExistingOutput (no suggestion)",
    (type: any) => {
      const error = validatePlot(
        {
          title,
          type,
          data: {
            z: "abracadabra",
          },
        },
        defaultOutputs
      );
      const message = `The plot titled "${title}" is referencing an non-existing output metric titled "abracadabra" inside of the "data.z" property.`;
      expectErrorToMatchExactly(
        error,
        PlotError,
        PlotIsReferencingNonExistingOutputError,
        message
      );
    }
  );

  test.skip.each(TwoParameterExperimentTypes)(
    "Plot type: %s -> Throws PlotIsReferencingNonExistingOutput (suggestion)",
    (type: any) => {
      const error = validatePlot(
        {
          title,
          type,
          data: {
            z: "countour", // should be "contour" (remove first u)
          },
        },
        {
          contour: [
            { op: GetOperator.get, field: "age" },
            { op: GetOperator.get, field: "age" },
          ],
          test2: [
            {
              op: FilterOperator.filter,
              field: "age",
              comparison: FilterComparator.eq,
              value: 5,
            },
            { op: GetOperator.get, field: "age " },
          ],
        }
      );
      const message = `The plot titled "${title}" is referencing an non-existing output metric titled "countour" inside of the "data.z" property. Did you mean "contour"?.`;
      expectErrorToMatchExactly(
        error,
        PlotError,
        PlotIsReferencingNonExistingOutputError,
        message
      );
    }
  );

  test.skip.each(TwoParameterExperimentTypes)(
    "Plot type: %s -> Throws PlotUsedOutputMustEndInAggregationOperationError",
    (type: any) => {
      const error = validatePlot(
        {
          title,
          type,
          data: {
            z: "contour",
          },
        },
        {
          contour: [
            { op: GetOperator.get, field: "age" },
            { op: GetOperator.get, field: "age" },
          ],
          test2: [
            {
              op: FilterOperator.filter,
              field: "age",
              comparison: FilterComparator.eq,
              value: 5,
            },
            { op: GetOperator.get, field: "age " },
          ],
        }
      );
      const message = `The plot titled "${title}" is referencing the output "contour" which does not end in an Aggregation Operation. Valid values are "max, min, mean, sum, count".`;
      expectErrorToMatchExactly(
        error,
        PlotError,
        PlotUsedOutputMustEndInAggregationOperationError,
        message
      );
    }
  );

  test.todo("TwoParameterExperiment: PlotIsMissingZDataPointsComponent");

  test.skip.each(TwoParameterExperimentTypes)(
    "Plot type: %s -> passes validation",
    (type: any) => {
      const success = validatePlot(
        {
          title,
          type,
          data: {
            z: "contour", // should be "contour" (remove first u)
          },
        },
        {
          contour: [
            { op: GetOperator.get, field: "age" },
            { op: AggregatorOperator.sum, field: "age" },
          ],
          test2: [
            {
              op: FilterOperator.filter,
              field: "age",
              comparison: FilterComparator.eq,
              value: 5,
            },
            { op: GetOperator.get, field: "age " },
          ],
        }
      );
      expect(success).toBe(true);
    }
  );

  test("Plot type: timeseries -> PlotDataIsNotAnArrayError", () => {
    const error = validatePlot(
      {
        title,
        type: "timeseries",
        data: {},
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" has an empty object in the "data" property.`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasEmptyDataObjectError,
      message
    );
  });

  test("Plot type: timeseries -> Throws PlotHasExtraDataFieldsError", () => {
    const error = validatePlot(
      {
        title,
        type: "timeseries",
        data: {
          y: "a",
          name: "a",
          extraProperty: "that shouldnt exist",
        },
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" has extra fields under the "data" property. The shape of this object must match "YDataPoints".`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasExtraDataFieldsError,
      message
    );
  });

  test("Plot type: timeseries -> Throws PlotHasTheWrongKindOfDataError (XDataPoints case + string)", () => {
    const error = validatePlot(
      {
        title,
        type: "timeseries",
        data: {
          x: "a",
          name: "a",
        },
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" is using an incorrect shape for the "data" property. It is expecting "YDataPoints" but you provided "XDataPoints"`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasTheWrongKindOfDataError,
      message
    );
  });

  test("Plot type: timeseries -> Throws PlotHasTheWrongKindOfDataError (ZDataPoints case + string)", () => {
    const error = validatePlot(
      {
        title,
        type: "timeseries",
        data: {
          z: "a",
          name: "a",
        },
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" is using an incorrect shape for the "data" property. It is expecting "YDataPoints" but you provided "ZDataPoints"`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasTheWrongKindOfDataError,
      message
    );
  });

  test("Plot type: timeseries -> Throws PlotIsReferencingNonExistingOutput (no suggestion)", () => {
    const error = validatePlot(
      {
        title,
        type: "timeseries",
        data: {
          y: "a",
          name: "a",
        },
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" is referencing an non-existing output metric titled "a" inside of the "data.y" property.`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsReferencingNonExistingOutputError,
      message
    );
  });

  test("Plot type: timeseries -> Throws PlotIsReferencingNonExistingOutput (suggestion)", () => {
    const error = validatePlot(
      {
        title,
        type: "timeseries",
        data: {
          y: "hellu",
          name: "a",
        },
      },
      {
        hello: [
          { op: GetOperator.get, field: "age " },
          { op: GetOperator.get, field: "age " },
        ],
        nothingLikeThePreviousOnes: [
          {
            op: FilterOperator.filter,
            field: "age",
            comparison: FilterComparator.eq,
            value: 5,
          },
          { op: GetOperator.get, field: "age " },
        ],
      }
    );
    const message = `The plot titled "${title}" is referencing an non-existing output metric titled "hellu" inside of the "data.y" property. Did you mean "hello"?.`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsReferencingNonExistingOutputError,
      message
    );
  });

  test("Plot type: timeseries -> Throws PlotIsMissingYDataPointsComponent", () => {
    const error = validatePlot(
      {
        title,
        type: "timeseries",
        data: {
          name: "a",
        },
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" is missing the "data.y" property, which must be of type "string" or "string[]".`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsMissingYDataPointsComponentError,
      message
    );
  });

  test("Plot type: histogram -> Throws PlotHasEmptyDataObjectError", () => {
    const error = validatePlot(
      {
        title,
        type: "histogram",
        data: {},
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" has an empty object in the "data" property.`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasEmptyDataObjectError,
      message
    );
  });

  test("Plot type: histogram -> Throws PlotHasExtraDataFields", () => {
    const error = validatePlot(
      {
        title,
        type: "histogram",
        data: {
          x: "a",
          name: "a",
          extraProperty: "that shouldnt exist",
        },
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" has extra fields under the "data" property. The shape of this object must match "XDataPoints or YDataPoints".`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasExtraDataFieldsError,
      message
    );
  });

  test("Plot type: histogram -> Throws PlotHasTheWrongKindOfDataError (ZDataPoints case)", () => {
    const error = validatePlot(
      {
        title,
        type: "histogram",
        data: {
          z: "a",
          name: "a",
        },
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" is using an incorrect shape for the "data" property. It is expecting "XDataPoints or YDataPoints" but you provided "ZDataPoints"`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotHasTheWrongKindOfDataError,
      message
    );
  });

  test("Plot type: histogram -> Throws PlotIsReferencingNonExistingOutputError (no suggestion)", () => {
    const error = validatePlot(
      {
        title,
        type: "histogram",
        data: {
          x: "a",
          name: "a",
        },
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" is referencing an non-existing output metric titled "a" inside of the "data.x" property.`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsReferencingNonExistingOutputError,
      message
    );
  });

  test("Plot type: histogram -> Throws PlotIsReferencingNonExistingOutputError (suggestion)", () => {
    const error = validatePlot(
      {
        title,
        type: "histogram",
        data: {
          x: "hellu",
          name: "a",
        },
      },
      {
        hello: [
          { op: GetOperator.get, field: "age " },
          { op: GetOperator.get, field: "age " },
        ],
        nothingLikeThePreviousOnes: [
          {
            op: FilterOperator.filter,
            field: "age",
            comparison: FilterComparator.eq,
            value: 5,
          },
          { op: GetOperator.get, field: "age " },
        ],
      }
    );
    const message = `The plot titled "${title}" is referencing an non-existing output metric titled "hellu" inside of the "data.x" property. Did you mean "hello"?.`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsReferencingNonExistingOutputError,
      message
    );
  });

  test("Plot type: histogram -> Throws PlotIsMissingYAndXDataPointsComponentError", () => {
    const error = validatePlot(
      {
        title,
        type: "histogram",
        data: {
          name: "a",
        },
      },
      defaultOutputs
    );
    const message = `The plot titled "${title}" is missing both "data.x" and "data.y" properties, though only one can be used at a time. The value must be of type "string".`;
    expectErrorToMatchExactly(
      error,
      PlotError,
      PlotIsMissingYAndXDataPointsComponentError,
      message
    );
  });

  test.each(["line", "scatter"])(
    "Plot type: %s -> Throws PlotHasNoDataError",
    (type) => {
      const error = validatePlot(
        {
          title,
          type,
        },
        defaultOutputs
      );
      const message = `The plot titled "${title}" is missing the required "data" property. Depending on the Plot Type, it must contain an array of either XDataPoints, YDataPoints or ZDataPoints.`;
      expectErrorToMatchExactly(error, PlotError, PlotHasNoDataError, message);
    }
  );

  test.each(["line", "scatter"])(
    "Plot type: %s -> Throws PlotHasEmptyDataObjectError (b/c when you give it an object it will wrap it in array automatically)",
    (type) => {
      const error = validatePlot(
        {
          title,
          type,
          data: {},
        },
        defaultOutputs
      );
      const message = `The plot titled "${title}" has an empty object in the "data" property.`;
      expectErrorToMatchExactly(
        error,
        PlotError,
        PlotHasEmptyDataObjectError,
        message
      );
    }
  );
});
