import {
  ChartTypes,
  ComparisonTypes,
  Operation,
  OperationTypes,
} from "./types";
import { analysisFileId, stringifyAnalysis } from "../../features/files/utils";
import {
  onDuplicateMetric,
  onOutputMetricsModalDelete,
  onOutputMetricsModalSave,
  onPlotsModalDelete,
  onPlotsModalSave,
} from "./modals";

const operations: Operation[] = [
  {
    op: OperationTypes.filter,
    field: "field1",
    comparison: ComparisonTypes.eq,
    value: "value",
  },
];

const baseWriteToFileTests = (input: any, newValues: any) => {
  expect(input.dispatch).toHaveBeenCalledTimes(1);
  expect(input.dispatch).toHaveBeenCalledWith({
    type: "files/updateFile",
    payload: {
      id: analysisFileId,
      contents: stringifyAnalysis(newValues),
    },
  });
  expect(input.setAnalysis).toHaveBeenCalledTimes(1);
  expect(input.setAnalysis).toHaveBeenCalledWith({
    lastAnalysisString: input.analysisString ?? null,
    analysis: newValues,
    error: null,
  });
};

// Tests:
// - Should add the new key
// - Should dispatch action accordingly
// - updateFile must be called with analysisFileId  as the target
// - everything must be called once only
test("onOutputMetricsModalSave: Add a new output metric", () => {
  const input = {
    dispatch: jest.fn(),
    setAnalysis: jest.fn(),
    analysisString: "clearly hardcoded",
    analysis: { outputs: {}, plots: [] },
    data: {
      title: "theMetricTitle",
      operations,
    },
  };
  const newValues = {
    outputs: {
      [input.data.title]: input.data.operations,
    },
    plots: [],
  };
  onOutputMetricsModalSave(input);
  baseWriteToFileTests(input, newValues);
});

// Tests:
// - All from the "Create" test
// - Edit an existing metric should delete the older key
// - should dispatch updateFile with analysisFileId and right contents
// - should call setAnalysis with the right parameters
test("onOutputMetricsModalSave: Edit an existing metric", () => {
  const input = {
    dispatch: jest.fn(),
    setAnalysis: jest.fn(),
    analysis: { outputs: {}, plots: [] },
    data: {
      title: "theMetricTitleUpdated",
      operations,
    },
    plotKey: "theMetricTitle",
  };
  const newValues = {
    outputs: {
      [input.data.title]: input.data.operations,
    },
    plots: [],
  };
  onOutputMetricsModalSave(input);
  baseWriteToFileTests(input, newValues);
});

test("onOutputMetricsModalDelete: Deletes an existing metric", () => {
  const input = {
    dispatch: jest.fn(),
    setAnalysis: jest.fn(),
    analysis: {
      outputs: {
        theMetricTitle: {
          title: "theMetricTitle",
          operations,
        },
      },
      plots: [],
    },
    keyToDelete: "theMetricTitle",
  };
  const newValues = {
    outputs: {},
    plots: [],
  };
  onOutputMetricsModalDelete(input);
  baseWriteToFileTests(input, newValues);
});

test("onOutputMetricsModalDelete: Trying to delete a non existing metric returns void", () => {
  const input = {
    dispatch: jest.fn(),
    setAnalysis: jest.fn(),
    analysis: {
      outputs: {
        theMetricTitle: {
          title: "theMetricTitle",
          operations,
        },
      },
      plots: [],
    },
    keyToDelete: "IClearlyDoNotExist",
  };
  expect(onOutputMetricsModalDelete(input)).toBeUndefined();
  expect(input.dispatch).not.toHaveBeenCalled();
  expect(input.setAnalysis).not.toHaveBeenCalled();
});

test("onDuplicateMetric: duplicates metric", () => {
  const input = {
    dispatch: jest.fn(),
    setAnalysis: jest.fn(),
    analysis: {
      outputs: {
        theMetricTitle: {
          title: "theMetricTitle",
          operations,
        },
      },
      plots: [],
    },
    metricKey: "theMetricTitle",
  };
  const newValues = {
    outputs: Object.assign({}, input.analysis.outputs, {
      theMetricTitle_copy: {
        title: "theMetricTitle",
        operations,
      },
    }),
    plots: [],
  };
  onDuplicateMetric(input);
  baseWriteToFileTests(input, newValues);
});

test("onDuplicateMetric: fails to duplicate metric if it does not exist", () => {
  const input = {
    dispatch: jest.fn(),
    setAnalysis: jest.fn(),
    analysis: {
      outputs: {
        theMetricTitle: {
          title: "theMetricTitle",
          operations,
        },
      },
      plots: [],
    },
    metricKey: "ThisOneDoesNotExistAndIKnowIt",
  };
  expect(onDuplicateMetric(input)).toBeUndefined();
  expect(input.dispatch).not.toHaveBeenCalled();
  expect(input.setAnalysis).not.toHaveBeenCalled();
});

test("onPlotsModalDelete: deletes the plot", () => {
  const input = {
    dispatch: jest.fn(),
    setAnalysis: jest.fn(),
    analysis: {
      outputs: {
        theMetricTitle: {
          title: "theMetricTitle",
          operations,
        },
      },
      plots: [
        {
          title: "Such a nice title",
          type: "bar",
          data: [{ y: "theMetricTitle", name: "theMetrictitle" }],
          layout: { width: "100%", height: "50%" },
          position: { x: "0%", y: "0%" },
        },
      ],
    },
    indexToDelete: 0,
  };
  const newValues = {
    outputs: Object.assign({}, input.analysis.outputs),
    plots: [],
  };
  onPlotsModalDelete(input);
  baseWriteToFileTests(input, newValues);
});

test("onPlotsModalDelete: avoids deleting the plot if it doesnt exist", () => {
  const input = {
    dispatch: jest.fn(),
    setAnalysis: jest.fn(),
    analysis: {
      outputs: {
        theMetricTitle: {
          title: "theMetricTitle",
          operations,
        },
      },
      plots: [
        {
          title: "Such a nice title",
          type: "bar",
          data: [{ y: "theMetricTitle", name: "theMetrictitle" }],
          layout: { width: "100%", height: "50%" },
          position: { x: "0%", y: "0%" },
        },
      ],
    },
    indexToDelete: 42,
  };
  expect(onPlotsModalDelete(input)).toBeUndefined();
  expect(input.dispatch).not.toHaveBeenCalled();
  expect(input.setAnalysis).not.toHaveBeenCalled();
});

// Tests:
// - Should add the new key
// - Should dispatch action accordingly
// - updateFile must be called with analysisFileId  as the target
// - everything must be called once only
test("onPlotsModalSave: Add a new Plot", () => {
  const input = {
    dispatch: jest.fn(),
    setAnalysis: jest.fn(),
    analysisString: "clearly hardcoded",
    analysis: {
      outputs: {
        field1: {
          title: "field1",
          operations,
        },
      },
      plots: [],
    },
    data: {
      title: "theMetricTitle",
      chartType: { value: ChartTypes.area, label: ChartTypes.area },
      position: { x: "0%", y: "0%" },
      yitems: [
        { name: "field1", metric: "field1" },
        { name: "field2", metric: "field2" },
      ],
      layout: { width: "100%", height: "50%" },
    },
  };
  const newValues = Object.assign({}, input.analysis, {
    plots: [
      {
        title: input.data.title,
        type: ChartTypes.area,
        data: [
          { y: "field1", stackgroup: "one", name: "field1" },
          { y: "field2", stackgroup: "one", name: "field2" },
        ],
        layout: input.data.layout,
        position: input.data.position,
      },
    ],
  });

  onPlotsModalSave(input);
  baseWriteToFileTests(input, newValues);
});

test("onPlotsModalSave: Add a new 'box' Plot", () => {
  const input = {
    dispatch: jest.fn(),
    setAnalysis: jest.fn(),
    analysisString: "clearly hardcoded",
    analysis: {
      outputs: {
        field1: {
          title: "field1",
          operations,
        },
      },
      plots: [],
    },
    data: {
      title: "theMetricTitle",
      chartType: { value: ChartTypes.box, label: ChartTypes.box },
      yitems: [{ name: "plot label", metric: "field1" }],
      layout: { width: "100%", height: "50%" },
      position: { x: "0%", y: "0%" },
    },
  };
  const newValues = Object.assign({}, input.analysis, {
    plots: [
      {
        title: input.data.title,
        type: ChartTypes.box,
        data: [{ y: "field1", name: "plot label" }],
        layout: input.data.layout,
        position: input.data.position,
      },
    ],
  });
  onPlotsModalSave(input);
  baseWriteToFileTests(input, newValues);
});

// Tests:
// - All from the "Create" test
// - Edit an existing Plot should update the existing plot
// - should dispatch updateFile with analysisFileId and right contents
// - should call setAnalysis with the right parameters
test("onPlotsModalSave: Edit an existing metric", () => {
  const input = {
    dispatch: jest.fn(),
    setAnalysis: jest.fn(),
    analysis: {
      outputs: {
        field1: {
          title: "field1",
          operations: [
            { op: "filter", field: "field1", comparison: "eq", value: "value" },
          ],
        },
        field2: {
          title: "field2",
          operations: [
            { op: "filter", field: "field2", comparison: "eq", value: "value" },
          ],
        },
      },
      plots: [
        {
          title: "theMetricTitle",
          type: "bar",
          data: [{ y: "field1", name: "field1" }],
          layout: { width: "100%", height: "50%" },
          position: { x: "0%", y: "0%" },
        },
      ],
    },
    data: {
      title: "thisIsAnUpdatedTitle",
      chartType: { value: ChartTypes.area, label: ChartTypes.area },
      yitems: [
        { name: "field1", metric: "field1" },
        { name: "field2", metric: "field2" },
      ],
      layout: { width: "100%", height: "50%" },
      position: { x: "0%", y: "0%" },
    },
    plotIndex: 0,
  };
  const newValues = Object.assign({}, input.analysis, {
    plots: [
      {
        title: input.data.title,
        type: ChartTypes.area,
        data: [
          { y: "field1", stackgroup: "one", name: "field1" },
          { y: "field2", stackgroup: "one", name: "field2" },
        ],
        layout: input.data.layout,
        position: input.data.position,
      },
    ],
  });
  onPlotsModalSave(input);
  baseWriteToFileTests(input, newValues);
});

// Tests:

test("onPlotsModalSave: Edit changing the type to timeseries", () => {
  const input = {
    dispatch: jest.fn(),
    setAnalysis: jest.fn(),
    analysis: {
      outputs: {
        field1: {
          title: "field1",
          operations: [
            { op: "filter", field: "field1", comparison: "eq", value: "value" },
          ],
        },
        field2: {
          title: "field2",
          operations: [
            { op: "filter", field: "field2", comparison: "eq", value: "value" },
          ],
        },
      },
      plots: [
        {
          title: "theMetricTitle",
          type: "bar",
          data: [{ name: "field1", metric: "field1" }],
          layout: { width: "100%", height: "50%" },
          position: { x: "0%", y: "0%" },
        },
      ],
    },
    data: {
      title: "thisIsAnUpdatedTitle",
      chartType: { value: ChartTypes.timeseries, label: ChartTypes.timeseries },
      yitems: [
        { name: "field1", metric: "field1" },
        { name: "field2", metric: "field2" },
      ],
      layout: { width: "100%", height: "50%" },
      position: { x: "0%", y: "0%" },
    },
    plotIndex: 0,
  };
  const newValues = Object.assign({}, input.analysis, {
    plots: [
      {
        title: input.data.title,
        type: ChartTypes.timeseries,
        data: [
          { y: "field1", name: "field1" },
          { y: "field2", name: "field2" },
        ],
        layout: input.data.layout,
        position: input.data.position,
      },
    ],
  });
  onPlotsModalSave(input);
  baseWriteToFileTests(input, newValues);
});

test("onPlotsModalSave: Edit changing type to area", () => {
  const input = {
    dispatch: jest.fn(),
    setAnalysis: jest.fn(),
    analysis: {
      outputs: {
        field1: {
          title: "field1",
          operations: [
            { op: "filter", field: "field1", comparison: "eq", value: "value" },
          ],
        },
        field2: {
          title: "field2",
          operations: [
            { op: "filter", field: "field2", comparison: "eq", value: "value" },
          ],
        },
      },
      plots: [
        {
          title: "theMetricTitle",
          type: "bar",
          data: [{ y: "field1", name: "field1" }],
          layout: { width: "100%", height: "50%" },
          position: { x: "0%", y: "0%" },
        },
      ],
    },
    data: {
      title: "thisIsAnUpdatedTitle",
      chartType: { value: ChartTypes.area, label: ChartTypes.area },
      yitems: [
        { name: "field1", metric: "field1" },
        { name: "field2", metric: "field2" },
      ],
      layout: { width: "100%", height: "50%" },
      position: { x: "0%", y: "0%" },
    },
    plotIndex: 0,
  };
  const newValues = Object.assign({}, input.analysis, {
    plots: [
      {
        title: input.data.title,
        type: ChartTypes.area,
        data: [
          { y: "field1", stackgroup: "one", name: "field1" },
          { y: "field2", stackgroup: "one", name: "field2" },
        ],
        layout: input.data.layout,
        position: input.data.position,
      },
    ],
  });
  onPlotsModalSave(input);
  baseWriteToFileTests(input, newValues);
});

test("onPlotsModalSave: Edit changing type to histogram", () => {
  const input = {
    dispatch: jest.fn(),
    setAnalysis: jest.fn(),
    analysis: {
      outputs: {
        field1: {
          title: "field1",
          operations: [
            { op: "filter", field: "field1", comparison: "eq", value: "value" },
          ],
        },
        field2: {
          title: "field2",
          operations: [
            { op: "filter", field: "field2", comparison: "eq", value: "value" },
          ],
        },
      },
      plots: [
        {
          title: "theMetricTitle",
          type: "bar",
          data: [{ y: "field1", name: "field1" }],
          layout: { width: "100%", height: "50%" },
          position: { x: "0%", y: "0%" },
        },
      ],
    },
    data: {
      title: "thisIsAnUpdatedTitle",
      chartType: { value: ChartTypes.histogram, label: ChartTypes.histogram },
      xitems: [
        { name: "field1", metric: "field1" },
        { name: "field2", metric: "field2" },
      ],
      layout: { width: "100%", height: "50%" },
      position: { x: "0%", y: "0%" },
    },
    plotIndex: 0,
  };
  const newValues = Object.assign({}, input.analysis, {
    plots: [
      {
        title: input.data.title,
        type: ChartTypes.histogram,
        data: [
          { x: "field1", name: "field1" },
          { x: "field2", name: "field2" },
        ],
        layout: input.data.layout,
        position: input.data.position,
      },
    ],
  });
  onPlotsModalSave(input);
  baseWriteToFileTests(input, newValues);
});
