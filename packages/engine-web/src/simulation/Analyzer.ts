import { AgentState } from "../glue";
import { OutputDefinition, OutputSeries, Outputs } from "./types";

export class Analyzer {
  private outputDefinitions: OutputDefinition[];

  // The most recent mapping of states
  private series: OutputSeries = {};
  private length: number = 0;
  private latestOutputs: Outputs = {};

  constructor(outputs: OutputDefinition[]) {
    this.outputDefinitions = outputs;
  }

  analyze(state: AgentState[]) {
    this.latestOutputs = {};

    // Analyze the state and then add the outputs of each output fn to an internal series
    this.outputDefinitions.forEach(({ name, fn }) => {
      this.latestOutputs[name] = fn(state, this.series);
      this.get(name).push(this.latestOutputs[name]);
    });
    this.length += 1;

    return this.latestOutputs;
  }

  outputs() {
    return this.latestOutputs;
  }

  private get(key: string) {
    if (this.series[key] === undefined) {
      this.series[key] = Array(this.length).fill(null);
    }
    return this.series[key];
  }
}
