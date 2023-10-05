import React, { FC, useEffect, useMemo, useRef, useState } from "react";
import Plot, { Figure } from "react-plotly.js";
import * as Plotly from "plotly.js";
import { Subject } from "rxjs";

import { IconSpinner } from "../Icon";
import { OutputPlotProps } from "./types";
import { exhaustMapWithTrailing } from "../../util/exhaustMapWithTrailing";
import {
  getValidPlotTypes,
  isASingleStepAggregationOperation,
} from "../../features/analysis/utils";
import { useResizeObserver } from "../../hooks/useResizeObserver/useResizeObserver";
import { yieldToBrowser } from "../../util/yieldToBrowser";

const mapLayout = (
  layout: Partial<Plotly.Layout>,
  currentStep: number,
  hideStep: boolean | undefined
): Partial<Plotly.Layout> => {
  const cloned = JSON.parse(JSON.stringify(layout));

  return {
    ...cloned,
    title: undefined, // remove title since we render it outside of OutputPlot
    shapes: (cloned.shapes ?? []).concat(
      currentStep && !hideStep
        ? [
            {
              type: "line",
              yref: "paper",
              y0: 0,
              y1: 1,
              x0: currentStep,
              x1: currentStep,
              line: {
                color: "grey",
                width: 1.5,
                dash: "dot",
              },
            },
          ]
        : []
    ),
  };
};

const getLastOperationFromOperationChain = (
  definition: any,
  outputs: { [index: string]: any[] },
  axisToUse: "x" | "y",
  index: number
) => {
  const outputMetricKey = definition?.data?.[index][axisToUse];
  if (!outputMetricKey) {
    return false;
  }
  const currentOutput = outputs[outputMetricKey];
  if (!currentOutput) {
    return false;
  }
  return currentOutput[currentOutput.length - 1];
};

const isAxisAvailable = (
  definition: any,
  index: number,
  axisToUse: "x" | "y"
) => !!(definition?.data?.[index] && definition.data[index][axisToUse]);
const doLastOperationTypesMatch = (
  definition: any,
  outputs: { [index: string]: any[] },
  index: number
) => {
  const x = isASingleStepAggregationOperation(
    getLastOperationFromOperationChain(definition, outputs, "x", index)
  );
  const y = isASingleStepAggregationOperation(
    getLastOperationFromOperationChain(definition, outputs, "y", index)
  );
  return x === y;
};

/**
 * Transforms the Plot data before it's given to Plotly to provide the
 * Current Step and Range cases covered in the Top Plots -> Data sources document.
 * https://www.notion.so/hashintel/Top-Plots-6e34aa5d0a7344edb197e48918fb09f7
 *
 */
const prepareDataBasedOnOutputMetricsLastOperation = async (
  definition: any,
  outputs: { [index: string]: any[] },
  clonedData: any,
  currentStep: number
) => {
  const result = JSON.parse(JSON.stringify(clonedData));
  if (!definition.type) {
    return result;
  }
  if (!getValidPlotTypes().includes(definition.type)) {
    return result;
  }
  switch (definition.type) {
    case "bar": {
      for (let index = 0; index < clonedData.length; index++) {
        const item = clonedData[index];
        const yAxisAvailable = isAxisAvailable(definition, index, "y");
        if (!yAxisAvailable) {
          continue;
        }
        const output = definition?.data?.[index];

        result[index].y = [item.y[currentStep - 1]]; // current step datasource
        result[index].x = [output.name ?? output.y];
        await yieldToBrowser();
      }
      break;
    }

    case "box": {
      for (let index = 0; index < clonedData.length; index++) {
        const xAxisAvailable = isAxisAvailable(definition, index, "x");
        const yAxisAvailable = isAxisAvailable(definition, index, "y");
        const lastOp = getLastOperationFromOperationChain(
          definition,
          outputs,
          "y",
          index
        );
        const lastYOperationIsAnAggregationOperation = isASingleStepAggregationOperation(
          lastOp
        );
        if (!yAxisAvailable || xAxisAvailable) {
          continue;
        }
        result[index].name =
          definition?.data?.[index].name ?? definition?.data?.[index].y;
        if (lastYOperationIsAnAggregationOperation) {
          // Covering Range case
          result[index].y = clonedData[index].y.slice(0, currentStep);
        }
        if (lastOp.op === "get") {
          // Covering Current Step case
          result[index].y = clonedData[index].y[currentStep - 1];
        }
        await yieldToBrowser();
      }
      break;
    }

    // TODO: once we get to experiments/collated view + accumulative ops
    // case "contour":
    // case "heatmap":
    //   break;

    case "histogram": {
      // TODO: implement Overlaid (useful for experiment-level) as described on the doc.
      for (let index = 0; index < clonedData.length; index++) {
        const xAxisAvailable = isAxisAvailable(definition, index, "x");
        const yAxisAvailable = isAxisAvailable(definition, index, "y");
        if (xAxisAvailable && yAxisAvailable) {
          continue;
        }
        const axisToUse = xAxisAvailable ? "x" : "y";
        const lastOperation = getLastOperationFromOperationChain(
          definition,
          outputs,
          axisToUse,
          index
        );
        if (!lastOperation) {
          continue;
        }
        result[index].name =
          definition?.data?.[index]?.name ??
          definition?.data?.[index][axisToUse];
        if (lastOperation.op === "get") {
          // Covering Current Step case
          const theCurrentStep = clonedData[index][axisToUse][currentStep - 1];
          if (
            theCurrentStep &&
            Array.isArray(theCurrentStep) &&
            theCurrentStep[0]
          ) {
            result[index][axisToUse] =
              clonedData[index][axisToUse][currentStep - 1][0];
          } else {
            result[index][axisToUse] =
              clonedData[index][axisToUse][currentStep - 1];
          }
        } else {
          // Covering Range case
          result[index][axisToUse] = clonedData[index][axisToUse].slice(
            0,
            currentStep
          );
        }
        await yieldToBrowser();
      }
      break;
    }

    case "line":
    case "scatter": {
      for (let index = 0; index < clonedData.length; index++) {
        const xAxisAvailable = isAxisAvailable(definition, index, "x");
        const yAxisAvailable = isAxisAvailable(definition, index, "y");
        const lastOperationsTypesAreMatching = doLastOperationTypesMatch(
          definition,
          outputs,
          index
        );
        const lastXOperationIsAnAggregationOperation = isASingleStepAggregationOperation(
          getLastOperationFromOperationChain(definition, outputs, "x", index)
        );
        result[index].type = "scatter";
        result[index].mode =
          definition.type === "scatter" ? "markers" : "lines";

        if (
          xAxisAvailable &&
          yAxisAvailable &&
          lastOperationsTypesAreMatching
        ) {
          // current step case
          if (!lastXOperationIsAnAggregationOperation) {
            result[index].x = clonedData[index].x[currentStep - 1];
            result[index].y = clonedData[index].y[currentStep - 1];
          }
          // range case
          else {
            result[index].x = clonedData[index].x.slice(0, currentStep);
            result[index].y = clonedData[index].y.slice(0, currentStep);
          }
        }

        // only Y case
        if (
          !xAxisAvailable &&
          yAxisAvailable &&
          lastXOperationIsAnAggregationOperation
        ) {
          result[index].y = clonedData[index].y.slice(0, currentStep);
        }
        // TODO: add a just "z" axis as well to turn it into a 3d plot!
        await yieldToBrowser();
      }
      break;
    }
  }

  return result;
};

const usePreparePlotsObserver = (
  definition: any,
  outputs: { [index: string]: any[] },
  clonedData: any,
  currentStep: number
) => {
  // @todo type this
  const ref = useRef<
    Subject<{
      definition: any;
      outputs: { [index: string]: any[] };
      clonedData: any;
      currentStep: number;
    }>
  >(null as any);
  // @todo type this
  const [result, setResult] = useState<any | null>(null);

  if (!ref.current) {
    ref.current = new Subject();
  }

  useEffect(() => {
    const subscription = ref.current
      .pipe(
        exhaustMapWithTrailing((obj) =>
          prepareDataBasedOnOutputMetricsLastOperation(
            obj.definition,
            obj.outputs,
            obj.clonedData,
            obj.currentStep
          )
        )
      )
      .subscribe((result) => {
        setResult(result);
      });
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    ref.current.next({ definition, outputs, clonedData, currentStep });
  }, [definition, outputs, clonedData, currentStep]);

  return result;
};

/**
 * react-plotly is an imperfect wrapper around plotly, the latter of which
 * expects to be able to mutate passed in data. This means we need to clone
 * anything we pass into plotly from external to OutputPlot – as it may
 * unexpectedly mutate / that data may have been externally frozen.
 */
export const OutputPlot: FC<
  Omit<OutputPlotProps, "key"> & {
    currentStep: number;
    readonly: boolean;
    onEdit?: VoidFunction;
  }
> = ({
  data,
  layout,
  config,
  currentStep,
  hideStep,
  outputs,
  definition,
  readonly,
  onEdit,
}) => {
  const [plotlyConfig, setPlotlyConfig] = useState(() =>
    JSON.parse(JSON.stringify(config))
  );
  const [plotlyLayout, setPlotlyLayout] = useState(
    mapLayout({ ...layout, title: undefined }, currentStep, hideStep)
  );

  const clonedData = useMemo(() => JSON.parse(JSON.stringify(data)), [data]);

  const plotlyRef = useRef<Plot>(null);
  const resizeRef = useResizeObserver(
    () => {
      // @see https://github.com/plotly/react-plotly.js/issues/76#issuecomment-442503423
      (plotlyRef.current as any)?.resizeHandler?.();
    },
    {
      onObserve: null,
    }
  );

  // if a new layout comes through, update the state
  useEffect(() => {
    setPlotlyLayout(
      mapLayout({ ...layout, title: undefined }, currentStep, hideStep)
    );
  }, [currentStep, hideStep, layout]);

  // if a new config comes through, update the state
  useEffect(() => {
    setPlotlyConfig(JSON.parse(JSON.stringify(config)));
  }, [config]);

  // set plot loading
  const [loading, setLoading] = useState(true);
  const preparedData = usePreparePlotsObserver(
    definition,
    outputs ?? {},
    clonedData,
    currentStep
  );

  return (
    <>
      <h3 className="PlotViewer__Plots__PlotTitle">
        {definition.title}{" "}
        {readonly ? null : <button onClick={onEdit}>(Edit)</button>}{" "}
        {loading ? <IconSpinner size={16} /> : null}
      </h3>
      <div ref={resizeRef}>
        <Plot
          ref={plotlyRef}
          data={preparedData}
          config={plotlyConfig}
          layout={plotlyLayout}
          onAfterPlot={() => {
            setLoading(false);
          }}
          onInitialized={({ layout }: Readonly<Figure>) =>
            setPlotlyLayout(layout)
          }
          onUpdate={({ layout }: Readonly<Figure>) => setPlotlyLayout(layout)}
          useResizeHandler={true}
          style={{
            width: "100%",
            height: "100%",
          }}
        />
      </div>
    </>
  );
};
