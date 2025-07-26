import PromiseWorker from "promise-worker-transferable";
import { Observable } from "rxjs";

import { ExperimentRunner, RunnerRequest } from "../index";
import { ExperimentStreamResponse } from "../experiments";
import { RunnerStatus } from "./index";

/**
 * Create a new simulation in an ephemeral web worker
 *
 * When using this class, note that dropping this also drops its worker
 * If you want things to be cached, don't drop this!
 */
export class WebWorkerRunner implements ExperimentRunner {
  activeRunId: string | null = null;
  rawWorker: Worker;
  worker: PromiseWorker;

  constructor(runnerId: string, fileName: string, devMode = false) {
    this.rawWorker = new Worker(fileName, { name: runnerId, type: "module" });
    this.worker = new PromiseWorker(this.rawWorker);
  }

  async handleRequest(req: RunnerRequest) {
    const resp: RunnerStatus = await this.worker.postMessage(req, []);
    this.activeRunId = resp.simulationRunId;
    return resp;
  }

  queueExperiment(): Observable<ExperimentStreamResponse> {
    throw new Error("cannot queue experiments on a single web worker");
  }
}
