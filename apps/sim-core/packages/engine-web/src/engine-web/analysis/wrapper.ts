import PromiseWorker from "promise-worker-transferable";

import { AnalyzerResponse } from "./analyzer";
import { SerializableAgentState } from "../../glue";

export class AnalyzerProvider {
  promiseWorker: PromiseWorker;

  constructor(path: string) {
    this.promiseWorker = new PromiseWorker(
      new Worker(path, { name: "hash-analyzer" })
    );
  }

  async analyze(
    state: SerializableAgentState[][]
  ): Promise<Extract<AnalyzerResponse, { type: "analyze" }>> {
    return this.promiseWorker.postMessage({ type: "analyze", data: state }, []);
  }

  async setAnalysisSrc(
    src: string
  ): Promise<Extract<AnalyzerResponse, { type: "setAnalysisSrc" }>> {
    return this.promiseWorker.postMessage({ type: "setAnalysisSrc", src }, []);
  }
}
