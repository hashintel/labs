// @todo remove ts-ignore
import React from "react";
import ReactDOM from "react-dom";
import { FluentUIComponents } from "@msrvida/fluentui-react-cdn-typings";
import * as fluentui from "@fluentui/react";
// @ts-ignore
import * as deck from "@deck.gl/core";
// @ts-ignore
import * as layers from "@deck.gl/layers";
// @ts-ignore
import * as luma from "@luma.gl/core";
import * as vega from "vega";
import { AgentState } from "@hashintel/engine-web";
import {
  Explorer,
  Explorer_Class,
  SandDance,
  ViewerOptions,
  getColorSettingsFromThemePalette,
  themePalettes,
  use,
} from "@msrvida/sanddance-explorer";

import "@msrvida/sanddance-explorer/dist/css/sanddance-explorer.css";
import "./StepExplorer.css";

fluentui.initializeIcons();
fluentui.loadTheme({
  palette: themePalettes["dark-theme"],
  defaultFontStyle: { fontFamily: "Inter" },
});
/**
 * some wild type aliasing, type vs. value, namespacing stuff going on here
 *
 * @see: packages/core/site.d.ts
 * @see: https://github.com/microsoft/SandDance/blob/master/packages/common-extensions/src/app.tsx
 */
use(
  fluentui as unknown as FluentUIComponents,
  React,
  ReactDOM,
  vega,
  deck,
  layers,
  luma,
);

function getViewerOptions() {
  const color = SandDance.VegaDeckGl.util.colorToString(
    SandDance.VegaDeckGl.util.colorFromString("white"),
  );

  const fontFamily = "Inter";

  const viewerOptions: Partial<ViewerOptions> = {
    colors: {
      ...getColorSettingsFromThemePalette(themePalettes["dark-theme"]),
      axisLine: color,
      axisText: color,
      hoveredCube: color,
    },
    fontFamily,
  };
  return viewerOptions;
}

export interface StepExplorerProps {
  data: AgentState[];
  step: number | undefined;
  visible: boolean;
  simId: string;
}

/**
 * The Microsoft-way of interacting with the explorer is by pulling it out of the mounted closure
 *
 * https://github.com/leozhoujf/Microsoft-OpenSource-SandDance-Visualization-Data-Tool/blob/b4e6bf8016b2c6ea0ef16a0876665d69d7f504d4/packages/sanddance-app/src/index.tsx#L35
 */
let sanddanceExplorerElement: Explorer_Class | undefined;

/**
 * getPartialInsight (defined below) needs access to the display dataset to determine the columns
 * This is typically not necessary, but is for us because we have to infer all the columns
 * Therefore, we drop displayData into the global scope
 */
interface InternalState {
  loaded: boolean;
  sandDanceData: AgentState[];
}

export class StepExplorer extends React.Component<
  StepExplorerProps,
  InternalState
> {
  constructor(props: StepExplorerProps) {
    super(props);
    this.state = {
      // Manage whether we need to "load" the data in
      loaded: false,

      // This array is passed by reference and needs to be modified in place
      // (But really should be a hook and a ref instead of a mutable state object)
      sandDanceData: [],
    };
  }

  componentDidMount() {
    this.updateDisplayData(this.props);
  }

  updateDisplayData(nextProps: Readonly<StepExplorerProps>) {
    const nextStep = nextProps.data;

    // Update the content of the data object is using to display
    if (nextStep) {
      // eslint-disable-next-line react/no-direct-mutation-state
      this.state.sandDanceData.length = 0;
      // Find all fields of all agents
      const allFields = new Set<string>();

      nextStep.forEach((agent) => {
        const new_agent = Object.assign({}, agent, {
          pos_x: (agent.position || [undefined])[0],
          pos_y: (agent.position || [undefined])[1],
          pos_z: (agent.position || [undefined])[2],
        });

        // Save the keys to insert into the first agent later
        Object.keys(new_agent).map((key: string) => {
          allFields.add(key);
        });

        // eslint-disable-next-line react/no-direct-mutation-state
        this.state.sandDanceData.push(new_agent);
      });

      // Set the unused fields on the first agent to undefined
      // This lets the sanddance recommender recognize that all fields exist
      allFields.forEach((field) => {
        if (
          !Object.prototype.hasOwnProperty.call(
            this.state.sandDanceData[0],
            field,
          )
        ) {
          // eslint-disable-next-line react/no-direct-mutation-state
          this.state.sandDanceData[0][field] = undefined;
        }
      });

      if (this.state.loaded === false) {
        // Loading adds a new WebGl context, be careful
        sanddanceExplorerElement?.load(this.state.sandDanceData);
        this.setState({
          loaded: true,
        });
      } else {
        // Force the viewer to render with its current insight but new data
        sanddanceExplorerElement?.viewer.render(
          sanddanceExplorerElement?.viewer.insight,
          this.state.sandDanceData,
        );
      }
    }
  }

  // We need to be very aggressive to suppress react updates on the SandDance component
  // Top-level re-renders are only allowed if the component is visible
  shouldComponentUpdate(nextProps: Readonly<StepExplorerProps>): boolean {
    if (
      // Check if we're scrubbing or coming out of hibernation
      (nextProps.visible && this.props.step !== nextProps.step) ||
      (nextProps.visible && !this.props.visible) ||
      (nextProps.visible && nextProps.simId !== this.props.simId)
    ) {
      this.updateDisplayData(nextProps);
      return true;

      // We're an active element and we need to respond to updates
    } else if (nextProps.visible) {
      return true;

      // Hibernate!
    } else {
      return false;
    }
  }

  render() {
    return (
      <Explorer
        theme={"dark-theme"}
        viewerOptions={getViewerOptions()}
        initialView="2d"
        mounted={(explorer) => {
          sanddanceExplorerElement = explorer;
        }}
        logoClickUrl={""}
        bingSearchDisabled={true}
      />
    );
  }
}
