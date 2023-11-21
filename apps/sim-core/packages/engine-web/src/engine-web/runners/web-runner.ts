import {
  DeferredPromise,
  ExperimentRun,
  ExperimentRunner,
  ExperimentSrc,
  RunnerRequest,
  RunnerStatus,
  WebWorkerRunner,
  experimentToRuns,
  prepareExperiment,
} from "..";
import { ExperimentPromises } from "../experiments";

type WorkerId = string;
type QueueEntry = [
  RunnerRequest,
  DeferredPromise<RunnerStatus>,
  DeferredPromise<void>
];

// experimentQueue = new Map<string, QueuedExperimentRun>();
export class WebExperimentRunner implements ExperimentRunner {
  workers = new Map<WorkerId, WebWorkerRunner>();
  simulationRunQueue = new Set<QueueEntry>();
  devMode = false;
  runningQueue = false;

  constructor(numWorkers: number, devMode: boolean, fileName: string) {
    this.devMode = devMode;

    for (let idx = 0; idx < numWorkers; idx++) {
      const workerId = `worker-web-${idx}`;
      const runner = new WebWorkerRunner(workerId, fileName, devMode);
      if (devMode) {
        console.log("Spinning up worker", workerId);
      }
      this.workers.set(workerId, runner);
    }
  }

  async handleRequest(
    req: RunnerRequest,
    simulationRunId: string
  ): Promise<RunnerStatus> {
    // This method should never be called, but regardless, throw an error
    throw new Error("Single-actions are not supported (yet) with experiments");
  }

  /**
   * @todo implement stream
   */
  async queueExperiment(
    src: ExperimentSrc
  ): Promise<ExperimentRun & ExperimentPromises> {
    const experiment = prepareExperiment(src);

    const runs = experimentToRuns(experiment, src.pyodideEnabled);

    // Create a collection of runner requests tied to a corresponding promise
    const runQueue: {
      [id: string]: QueueEntry;
    } = Object.fromEntries(
      [...runs].map<[string, QueueEntry]>((run) => [
        run.presetRunId ?? "",
        [run, new DeferredPromise<RunnerStatus>(), new DeferredPromise<void>()],
      ])
    );

    // Add the collection to our internal queue
    for (const req of Object.values(runQueue)) {
      this.simulationRunQueue.add(req);
    }

    // Extract the promises out for the frontend
    const runPromises = Object.fromEntries(
      Object.entries(runQueue).map(([runId, [, runnerProm]]) => [
        runId,
        runnerProm,
      ])
    );

    const startedPromises = Object.fromEntries(
      Object.entries(runQueue).map(([runId, [, , startedProm]]) => [
        runId,
        startedProm,
      ])
    );

    // Combine the completion of all the runs to a final experiment promise
    const experimentPromise = new DeferredPromise<void>();
    Promise.all(Object.values(runPromises))
      .then((_) => experimentPromise.resolve())
      .catch((why) => {});

    // Wake up our queue
    this.kick().catch((err) => console.error(err));

    const { manifest: _, queuedSimulationRunIds: __, ...run } = experiment;
    return {
      ...run,
      experimentPromise,
      runPromises,
      startedPromises,
    };
  }

  /**
   * This functions chews through the initalization message queue and tries to
   * disperse work when requests are returned. For as long as work is available,
   * the workers will do their best to eat through the queue.
   */
  async kick() {
    if (this.runningQueue) {
      return;
    }
    this.runningQueue = true;

    // Create a single promise that this function will wait on
    const futs: Promise<void>[] = [];
    for (const [, worker] of this.workers) {
      // Assemble a promise that ends when no more work is available to give to the worker

      const act = async () => {
        let init: QueueEntry = this.simulationRunQueue.values().next().value;

        while (init !== undefined) {
          this.simulationRunQueue.delete(init);

          // Report that we've started running
          init[2].resolve();

          // Run the simulation on the worker
          const newStatus = await worker.handleRequest(init[0]);
          const prom = init[1];
          prom.resolve(newStatus);

          // Get a new run, returning undefined if no worker exists
          init = this.simulationRunQueue.values().next().value;
        }
        this.runningQueue = false;
      };
      futs.push(act());
    }

    // Attach the promises to the return of the kick
    return Promise.all(futs);
  }
}
