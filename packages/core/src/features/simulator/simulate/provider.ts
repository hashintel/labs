import {
  CloudExperimentRunner,
  ExperimentPromises,
  ExperimentRun,
  ExperimentRunner,
  ExperimentSrc,
  ExperimentStreamResponse,
  ProviderTarget,
  ProviderTargetEnv,
  RunnerListener,
  RunnerRequest,
  RunnerStatus,
  SimulationRunId,
  WebExperimentRunner,
  WebWorkerRunner,
} from "@hashintel/engine-web";
import { Observable } from "rxjs";
import { v4 as uuid } from "uuid";

/**
 * Manage connections to anything that can run experiments.
 * Single runs are just experiments where no name has been provided.
 * The simulation provider is meant to persist globally on a page like the CORE IDE
 */
export class SimulationProvider implements ExperimentRunner {
  routes = new Map<SimulationRunId, string>();
  targets: Record<ProviderTargetEnv, ProviderTarget> | null = null;
  listeners = new Set<RunnerListener>();
  devMode = false;

  constructor(public target: ProviderTargetEnv) {}

  build(workerFileName: string, numWorkers = 4, devMode = false) {
    this.devMode = devMode;

    // For now, use the same dedicated runner for both cloud and web
    // When cloud can support single runs, this restriction will be lifted
    const dedicatedRunner = new WebWorkerRunner(
      "worker-web-dedicated",
      workerFileName,
      devMode,
    );

    this.targets = {
      web: {
        target: "web",
        dedicatedRunner,
        experimentRunners: new Map([
          [
            "experimenter-web-0",
            new WebExperimentRunner(numWorkers, devMode, workerFileName),
          ],
        ]),
      },
      cloud: {
        target: "cloud",
        dedicatedRunner,
        experimentRunners: new Map(),
      },
    };
  }

  /**
   * TODO @Jon Allow requests to be sent to non-dedicated runners
   * The point of this method is to direct a runner request to simulation run by its ID
   * It's mostly moot because cloud cannot handle single runs, so for now, it routes based on the dedicated runner
   */
  async handleRequest(
    request: RunnerRequest,
    _: string | null,
  ): Promise<RunnerStatus> {
    const { dedicatedRunner } = this.targets![this.target];

    const resp = await dedicatedRunner.handleRequest(request);
    this.alertSubscribers(resp);

    return resp;
  }

  queueExperiment(
    src: ExperimentSrc,
  ):
    | Observable<ExperimentStreamResponse>
    | Promise<ExperimentRun & ExperimentPromises> {
    switch (this.target) {
      case "cloud": {
        // Create a new cloud connection and add it to the experimenter group
        const experimenter = new CloudExperimentRunner(this.devMode);
        const experiment = experimenter.queueExperiment(src);

        // We don't know what the experiment id will be, so using uuid
        this.targets!.cloud.experimentRunners.set(uuid(), experimenter);
        return experiment;
      }

      case "web": {
        // Selecting the first element isn't _great_ but it maintains consistency
        const experimenter: ExperimentRunner =
          this.targets!.web.experimentRunners.values().next().value;

        // When the experiment is complete, alert the provider's subscribers
        return experimenter.queueExperiment(src);
      }
    }
  }

  alertSubscribers(status: RunnerStatus) {
    for (const sub of this.listeners) {
      sub(status);
    }
  }

  subscribe(listener: RunnerListener) {
    // Add this listener to our list in case we make any new experiment runners
    this.listeners.add(listener);

    // Allow unsubscriptions, though this probably won't be used
    return () => {
      this.listeners.delete(listener);
    };
  }
}
