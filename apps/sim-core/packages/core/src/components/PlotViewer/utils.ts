import * as m from "monocle-ts";
import type { Color, Datum, PlotData, ScatterLine } from "plotly.js";
import {
  DatumKeys,
  HashDatum,
  HashPlotData,
  OutputSeries,
  OutputSeriesValue,
  PlotDefinition,
  isOutputSlice,
} from "@hashintel/engine-web";
import { flow } from "fp-ts/es6/function";
import { merge } from "lodash";
import { pipe } from "fp-ts/es6/pipeable";

import { OutputPlotProps } from "./types";
import { mapColor } from "../../util/palette";
import { theme } from "../../util/theme";

function timeseriesToData(
  timeseries: string[],
  series: OutputSeries,
  step: number,
) {
  const data = [];
  for (const name of timeseries) {
    if (!series[name]) {
      continue;
    }
    const color = extractColor(name);
    data.push({
      name,
      y: series[name].slice(0, step + 1),
      type: "scatter",
      line: {
        color,
      },
    });
  }
  return data;
}

function or(a: any, b: any) {
  return a ?? b;
}

function scatterToData(scatter: string[], series: OutputSeries, step: number) {
  const data = [];
  for (const name of scatter) {
    if (!series[name]?.[step]) {
      continue;
    }
    const color = extractColor(name);
    data.push({
      name,
      x: (series[name][step] as Datum[]).map((a: any) =>
        or(a.position[0], a.x),
      ),
      y: (series[name][step] as Datum[]).map((a: any) =>
        or(a.position[1], a.y),
      ),
      mode: "markers",
      marker: {
        color: (series[name][step] as Datum[]).map(
          (agent: any) => agent.color || agent.rgb || color,
        ),
      },
      type: "scattergl",
    });
  }
  return data;
}

function scatter3dToData(
  scatter: string[],
  series: OutputSeries,
  step: number,
) {
  const data = [];
  for (const name of scatter) {
    if (!series[name]?.[step]) {
      continue;
    }
    const color = extractColor(name);
    data.push({
      name,
      x: (series[name][step] as Datum[]).map((a: any) =>
        or(a.position[0], a.x),
      ),
      y: (series[name][step] as Datum[]).map((a: any) =>
        or(a.position[1], a.y),
      ),
      z: (series[name][step] as Datum[]).map((a: any) =>
        or(a.position[2], a.z),
      ),
      mode: "markers",
      marker: {
        color: (series[name][step] as Datum[]).map(
          (agent: any) => agent.color || agent.rgb || color,
        ),
      },
      type: "scatter3d",
    });
  }
  return data;
}

const extractColor = (name: Color) =>
  typeof name === "string"
    ? name === "white"
      ? "gray"
      : `#${mapColor(name) ?? intToRGB(hashCode(name))}`
    : name;

// https://stackoverflow.com/a/3426956
function hashCode(str: string) {
  // java String#hashCode
  let hash = 0;
  for (let idx = 0; idx < str.length; idx++) {
    hash = str.charCodeAt(idx) + ((hash << 5) - hash);
  }
  return hash;
}

function intToRGB(int: number) {
  const char = (int & 0x00ffffff).toString(16).toUpperCase();

  return "00000".substring(0, 6 - char.length) + char;
}

export function buildPlots(def: PlotDefinition): OutputPlotProps {
  const layout = { ...def.layout } || {};

  const config = { ...def.config } || {};
  config.displaylogo = false;

  const style: React.CSSProperties = {};
  if (def.position) {
    style.position = "relative";
    style.left = def.position.x;
    style.top = def.position.y;
  }
  style.padding = "5px";
  style.boxSizing = "border-box";
  // we need to move width and height to the style
  // https://github.com/plotly/react-plotly.js#basic-props
  style.width = layout.width;
  style.height = layout.height;
  layout.width = undefined;
  layout.height = undefined;

  layout.hoverlabel = { namelength: -1 };

  if (def.layout?.hideLegend) {
    layout.showlegend = false;
  }
  layout.autosize = true;
  layout.title = merge({
    text: def.title,
    font: "Inter",
    x: 0.05,
  });

  if (def.timeseries) {
    layout.xaxis = merge(layout.xaxis, { title: "Step" });
    layout.yaxis = merge(layout.yaxis, { title: "Value" });
  } else if (def.scatter) {
    layout.xaxis = merge(layout.xaxis, {
      title: "x",
      zeroline: false,
    });
    layout.yaxis = merge(layout.yaxis, {
      title: "y",
      zeroline: false,
    });
    layout.hovermode = "closest";
  } else if (def.scatter3d) {
    layout.hovermode = "closest";
  }

  // Set the theme based on hash-preset themes
  SetPlotlyTheme({ theme: "HASH_dark", layout });

  const props = {
    key: JSON.stringify(def),
    data: [],
    layout,
    config,
    style,
    hideCollatedLegend: def.layout?.hideCollatedLegend,
    hideStep: ["bar", "box", "histogram", "line", "scatter"].includes(
      def.type ?? "",
    )
      ? true
      : def.hideStep,
    definition: {},
  };

  return props;
}

const datumLenses: {
  [K in DatumKeys]: m.Optional<HashPlotData, HashDatum<K>>;
} = {
  x: m.Optional.fromNullableProp<HashPlotData>()("x"),
  y: m.Optional.fromNullableProp<HashPlotData>()("y"),
  z: m.Optional.fromNullableProp<HashPlotData>()("z"),
};

const lineLens = m.Optional.fromNullableProp<HashPlotData>()("line");
const colorLens = m.Optional.fromNullableProp<Partial<ScatterLine>>()("color");

const flattenSlice = <K extends DatumKeys>(
  series: OutputSeriesValue[],
): PlotData[K] =>
  pipe(
    series,
    (series: OutputSeriesValue[]) => (series.length === 1 ? series[0] : series),
    (series) =>
      series === null || typeof series === "number"
        ? series
        : series.map((value) =>
            value instanceof Array && value.length === 1 ? value[0] : value,
          ),
  ) as PlotData[K];

const mapAxis =
  <K extends DatumKeys>(series: OutputSeries, step: number) =>
  (value: HashDatum<K>): PlotData[K] =>
    typeof value === "string"
      ? (series[value].slice(0, step + 1) as PlotData[K])
      : isOutputSlice(value)
        ? flattenSlice(series[value.name].slice(...value.slice))
        : value;

export function buildData(
  def: PlotDefinition,
  series: OutputSeries,
  step: number,
): Plotly.Data[] {
  if (def.timeseries) {
    return timeseriesToData(def.timeseries, series, step) as Plotly.Data[];
  } else if (def.scatter) {
    return scatterToData(def.scatter, series, step) as Plotly.Data[];
  } else if (def.scatter3d) {
    return scatter3dToData(def.scatter3d, series, step) as Plotly.Data[];
  } else if (def.data) {
    return def.data.map(
      flow(
        datumLenses.x.modify(mapAxis<"x">(series, step)),
        datumLenses.y.modify(mapAxis<"y">(series, step)),
        datumLenses.z.modify(mapAxis<"z">(series, step)),
        lineLens.compose(colorLens).modify(extractColor),
        (plot) => Object.assign({ type: def.type }, plot) as PlotData,
      ),
    );
  } else {
    return [];
  }
}

interface SetPlotlyThemeProps {
  theme: "HASH_dark";
  layout: Partial<Plotly.Layout>;
}

// Plotly.js doesn't have this function but plotly.py does
// Colors taken from: https://github.com/plotly/plotly.py/blob/master/packages/python/plotly/templategen/definitions.py
// Specific functions taken from: https://github.com/plotly/plotly.py/blob/master/packages/python/plotly/templategen/utils/__init__.py
function SetPlotlyTheme({ theme, layout }: SetPlotlyThemeProps) {
  const plot_style = PlotStyles[theme];

  // Set colors
  layout.font = merge(layout.font, {
    color: plot_style.font_clr,
    family: plot_style.font_family,
  });
  layout.paper_bgcolor = plot_style.paper_clr;
  layout.plot_bgcolor = plot_style.panel_background_clr;
  if (layout.ternary) {
    layout.ternary = merge(layout.ternary, {
      bgcolor: plot_style.panel_background_clr,
    });
  }

  // Modify the config and plot styles from the template
  switch (theme) {
    case "HASH_dark":
      // Increase grid width for 3d plots
      if (layout.scene) {
        layout.scene.xaxis = merge(layout.scene.xaxis, { gridwidth: 2 });
        layout.scene.yaxis = merge(layout.scene.xaxis, { gridwidth: 2 });
        layout.scene.zaxis = merge(layout.scene.xaxis, { gridwidth: 2 });
      }

      // Mapbox light style
      if (layout.mapbox) {
        layout.mapbox = merge(layout.mapbox, { style: "dark" });
      }
      break;
  }
}

const colorBars = {
  plasma: [
    "#0d0887",
    "#46039f",
    "#7201a8",
    "#9c179e",
    "#bd3786",
    "#d8576b",
    "#ed7953",
    "#fb9f3a",
    "#fdca26",
    "#f0f921",
  ],
};

const plotlyClrs = {
  "HASH Light": theme.white,
  "Rhino Medium 2": theme["light-grey"],
  "Rhino Medium 1": theme.grey,
  "Rhino Dark": "#171b1f",
  "Rhino Core": "#2a3f5f",
};

interface PlotStyle {
  paper_clr: string;
  font_clr: string;
  font_family: string;
  panel_background_clr: string;
  panel_grid_clr: string;
  axis_ticks_clr: string;
  zerolinecolor_clr: string;
  table_cell_clr: string;
  table_header_clr: string;
  table_line_clr: string;
  colorscale: string[];
}

const PlotStyles: Record<string, PlotStyle> = {
  HASH_dark: {
    paper_clr: theme.dark,
    font_clr: plotlyClrs["HASH Light"],
    font_family: "Inter",
    panel_background_clr: theme.dark,
    panel_grid_clr: theme.dark,
    axis_ticks_clr: plotlyClrs["Rhino Medium 1"],
    zerolinecolor_clr: plotlyClrs["Rhino Medium 2"],
    table_cell_clr: theme.dark,
    table_header_clr: plotlyClrs["Rhino Core"],
    table_line_clr: "#000000",
    colorscale: colorBars.plasma,
  },
};
