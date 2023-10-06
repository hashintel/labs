// @TODO: This is an UGLY duplication of OutputPlot that we had to make
// to release this. Burn this file soon (written on 2021-03-09)

import React, { FC, useEffect, useMemo, useRef, useState } from "react";
import Plot, { Figure } from "react-plotly.js";
import * as Plotly from "plotly.js";

import { IconSpinner } from "../Icon";
import { OutputPlotProps } from "./types";
import { useResizeObserver } from "../../hooks/useResizeObserver/useResizeObserver";

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

/**
 * react-plotly is an imperfect wrapper around plotly, the latter of which
 * expects to be able to mutate passed in data. This means we need to clone
 * anything we pass into plotly from external to OutputPlot – as it may
 * unexpectedly mutate / that data may have been externally frozen.
 */
export const OutputPlotCollated: FC<
  Omit<OutputPlotProps, "key"> & {
    currentStep: number;
    readonly: boolean;
    onEdit?: VoidFunction;
  }
> = ({ data, layout, config, currentStep, hideStep, readonly, onEdit }) => {
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

  const plotTitle =
    typeof layout.title === "string" ? layout.title : layout.title?.text;

  return (
    <>
      <h3 className="PlotViewer__Plots__PlotTitle">
        {plotTitle}{" "}
        {!readonly ? <button onClick={onEdit}>(Edit)</button> : null}{" "}
        {loading ? <IconSpinner size={16} /> : null}
      </h3>
      <div ref={resizeRef}>
        <Plot
          ref={plotlyRef}
          data={clonedData}
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
