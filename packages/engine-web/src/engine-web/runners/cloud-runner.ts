import { Observable, concat, of, throwError } from "rxjs";
import { mergeMap, share, takeWhile } from "rxjs/operators";

import {
  ExperimentRunner,
  ExperimentSrc,
  ExperimentStreamResponse,
  RunnerRequest,
  RunnerStatus,
  createExperimentDefinition,
} from "../../";

type SocketResponse = {
  experimentId: string;
  error?: string;
  compute_usage_remaining?: number;
  running: "running" | "stopping" | "finished";
  // computeUsageRemaining?: number;
  statuses?: {
    [id: string]: RunnerStatus;
  };
  simulations: {
    [index: number]: {
      id: string;
      changed_properties: { [id: string]: number | string | boolean };
    };
  };
};
const LOCAL_DEV = false;

export class CloudExperimentRunner implements ExperimentRunner {
  routes = new Map<string, string>();
  connection: WebSocket | null = null;
  devMode: boolean;
  wssConnectUrl: string;

  constructor(devMode: boolean) {
    this.devMode = devMode;
    this.wssConnectUrl = devMode
      ? LOCAL_DEV
        ? "ws://127.0.0.1:9000/connect/"
        : "wss://cloud-staging.hash.ai/connect/"
      : "wss://cloud.hash.ai/connect/";
  }

  async handleRequest(req: RunnerRequest): Promise<RunnerStatus> {
    // TODO @Jon this path should never be hit anyway, we don't provide a single cloud runner
    // We also don't expose individual controls of the runs via the sidebar
    throw new Error(
      "Sending single-runner commands to cloud is not supported!",
    );
  }

  /**
   * @todo removing subscription isn't closing connection
   */
  queueExperiment({
    experimentName,
    project,
    manifestSrc,
  }: ExperimentSrc): Observable<ExperimentStreamResponse> {
    // Parse the information we need to initiate an experiment with hCloud
    const experimentSrc: string = JSON.parse(manifestSrc)["experimentsSrc"];
    const experimentArgs = createExperimentDefinition(
      experimentSrc,
      experimentName,
    );

    const path = `${this.wssConnectUrl}?${new URLSearchParams({
      /**
       * Cloud is going to remove the numSteps requirement, at least for
       * optimization experiments
       *
       * @todo remove this
       */
      numSteps: (
        ("maxSteps" in experimentArgs
          ? experimentArgs.maxSteps
          : experimentArgs.steps) ?? 0
      ).toString(),
      experimentName,
      projectPath: project.path,
      projectRef: project.ref,
    })}`;

    const startedTime = Date.now();
    const notifiedSimulationIds = new Set<string>();
    const stoppedSimIds = new Set<string>();
    let created = false;
    let hasQueued = false;

    /**
     * As errors are deferred for a period of time (to ensure any other events
     * that get sent are processed), we want to prevent the stream from
     * "completing" (i.e, because the socket closed) whilst we're waiting for
     * an error notification to be sent.
     */
    let hasErrored = false;

    /**
     * This is a record of the latest valid metric outcome for experiments – we
     * don't want to accidentally unset a metric outcome because we receive a
     * status update that doesn't include one, so we only set to this when we
     * have a valid one, and we send by reading from this.
     */
    const metricOutcomes: Record<string, number> = {};

    /**
     * First, let's create a minimal Observable wrapper around the websocket
     * API. This is designed to only allow a single subscription per queued
     * experiment, because otherwise its too easy to accidentally create
     * multiple connections, which will end up creating multiple experiments in
     * hCloud. The job of this wrapper is mostly to handle creating the
     * connection, JSON parsing the response, throwing errors, and ignoring
     * pings. Later, we'll map individual status updates from hCore into
     * events which hCore can respond to.
     */
    return new Observable<SocketResponse>((subscriber) => {
      // Prevent multiple subscriptions
      if (created) {
        throw new Error("Can only subscribe once – call queueExperiment again");
      }
      created = true;

      try {
        this.connection = new WebSocket(path);

        this.connection!.onmessage = (evt) => {
          /**
           * hCloud regularly sends ping events to avoid the connection being
           * closed during long running experiments. We need to ignore those.
           */
          if (evt.data === "ping") {
            return;
          }

          try {
            const response: SocketResponse = JSON.parse(evt.data);

            if (response.error) {
              /**
               * Experiment failure!
               * Give it a beat for the websocket to process any other in-flight
               * requests before killing the run entirely
               */
              hasErrored = true;
              setTimeout(() => {
                subscriber.error(new Error(response.error));
              }, 250);
            }

            subscriber.next(response);
          } catch (err) {
            subscriber.error(err);
          }
        };

        // Fail out if the socket closes on us
        this.connection!.onclose = (evt) => {
          if (this.devMode) {
            console.warn(
              "Closing websocket connecting with cloud because: ",
              evt,
            );
          }
          if (!hasErrored) {
            subscriber.complete();
          }
        };
        this.connection!.onerror = (evt) => {
          subscriber.error(evt);
        };
      } catch (err) {
        subscriber.error(err);
      }

      return () => {
        this.connection?.close();
        this.connection = null;
      };
    }).pipe(
      // Helps to ensure there will only be one subscription
      share(),
      mergeMap((socketResponse) => {
        if (socketResponse.compute_usage_remaining === 0) {
          /**
           * When we run out of compute usage, append a compute credit error to
           * the event stream – this ensures any other information included in
           * this status update is properly handled
           */
          return concat(
            of(socketResponse),
            throwError(new Error("Out of cloud compute credits")),
          );
        }
        return of(socketResponse);
      }),
      takeWhile(
        (response) => hasErrored || response.running !== "finished",
        true,
      ),
      mergeMap((response) => {
        const responses: ExperimentStreamResponse[] = [];

        /**
         * New simulations for the experiment can be reported at any time, so
         * lets build an experiment plan for any new simulation runs, filtering
         * out ones we've previously been notified about
         */
        const experimentPlanEntries = Object.values(response.simulations)
          .filter((run) => !notifiedSimulationIds.has(run.id))
          .map((run) => {
            const newRun = {
              fields: run.changed_properties,
            };
            return [run.id, newRun] as const;
          });

        if (experimentPlanEntries.length > 0) {
          /**
           * The first response that includes a simulation will be used to parse
           * the experiment id and to report that an experiment has been
           * successfully queued, which moves it from a pending to an in
           * progress state. We ignore messages until this has happened, because
           * it may be a number of messages until we have anything important to
           * show for optimization experiments. This queued message is handled
           * specially by hCore.
           */
          if (!hasQueued) {
            hasQueued = true;
            responses.push({
              type: "queued",
              experiment: {
                experimentId: response.experimentId,
                experimentName,
                project,
                /**
                 * Cloud experiments are assumed to be running immediately as they don't
                 * report back to us when they have begun running – and their "pending"
                 * status functions as queued instead.
                 */
                status: "running",
                definition: experimentArgs,
                target: "cloud",
                startedTime,
                plan: {},
                simulationIds: [],
              },
            });
          }

          responses.push({
            type: "simulationsCreated",
            plan: Object.fromEntries(experimentPlanEntries),
          });

          for (const [id] of experimentPlanEntries) {
            notifiedSimulationIds.add(id);

            /**
             * The websocket doesn't currently tell us when the experiment has
             * actually started calculating so we'll just lie for now and say
             * it has begun as soon as we know it exists
             */
            responses.push({ simulationId: id, type: "started" });
          }
        }

        for (const status of Object.values(response.statuses ?? {})) {
          if (status.simulationRunId) {
            if (typeof status.metricOutcome === "number") {
              metricOutcomes[status.simulationRunId] = status.metricOutcome;
            }

            if (
              status.earlyStop &&
              !stoppedSimIds.has(status.simulationRunId)
            ) {
              stoppedSimIds.add(status.simulationRunId);
              responses.push({
                type: "earlyStop",
                status,
                simulationId: status.simulationRunId,
              });
            }

            if (status.stepsLink.analysisOutputs) {
              responses.push({
                simulationId: status.simulationRunId,
                status: {
                  ...status,
                  metricOutcome: metricOutcomes[status.simulationRunId],
                } as RunnerStatus,
                type: "analysis",
                link: status.stepsLink.analysisOutputs!,
              });
            }

            if (status.stepsLink.agentSteps) {
              responses.push({
                simulationId: status.simulationRunId,
                status,
                type: "steps",
              });
            }

            if (status.runnerError) {
              // We know a specific simulation run failed with an error
              const error = JSON.parse(JSON.stringify(status.runnerError));
              responses.push({
                simulationId: status.simulationRunId,
                type: "error",
                error,
              });
            }
          }
        }

        if (response.running === "stopping") {
          responses.push({ type: "stopping" });
        }

        return responses;
      }),
    );
  }
}
