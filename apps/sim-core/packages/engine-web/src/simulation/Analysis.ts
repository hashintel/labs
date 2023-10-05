import { OutputSeries, Outputs } from "./types";

export class Analysis {
  public series: OutputSeries;
  public length: number;

  constructor() {
    this.series = {};
    this.length = 0;
  }

  appendOutputs(outputs: Outputs) {
    for (const name in outputs) {
      if (!this.series[name]) {
        this.series[name] = Array(this.length).fill(null);
      }
      this.series[name].push(outputs[name]);
    }
    for (const name in this.series) {
      if (outputs[name] === undefined) {
        this.series[name].push(null);
      }
    }
    this.length += 1;
  }
}
