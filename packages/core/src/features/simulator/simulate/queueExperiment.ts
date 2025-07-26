import {
  ConnectableObservable,
  EMPTY,
  GroupedObservable,
  Observable,
  Subject,
  concat,
  from,
  of,
  race,
  throwError,
} from "rxjs";
import {
  ExperimentPromises,
  ExperimentRun,
  ExperimentSrc,
  ExperimentStreamResponse,
} from "@hashintel/engine-web";
import {
  catchError,
  filter,
  groupBy,
  map,
  mergeMap,
  multicast,
  take,
  tap,
} from "rxjs/operators";
import { v4 as uuid } from "uuid";

import {
  EXPERIMENT_PENDING_THRESHOLD,
  createCompleteManifest,
  simulationComplete,
} from "./util";
import { Scope, selectScope } from "../../scopes";
import { SimulatorThunk } from "../types";
import {
  addPendingExperiment,
  experimentFailed,
  experimentFinished,
  experimentSimulationsCreated,
  experimentStopping,
  initializeExperiment,
  setSelectedExperiment,
  setSimulationAnalysis,
  setSimulationStatus,
  simulationRunFailed,
  simulationRunStarted,
  simulationRunUpdated,
  updatePendingExperimentTime,
} from "./slice";
import { addUserAlert } from "../../viewer";
import { store as appStore } from "../../store";
import { earlyStopSimulation } from "./thunks";
import { historicCloudExperimentProvider } from "../historicCloudExperimentProvider";
import { parseAllBehaviorKeys } from "../../files/slice";
import { pyodideEnabled } from "../../../util/pyodideEnabled";
import { save } from "../../thunks";
import { selectAllSimulationData, selectExperimentRuns } from "./selectors";
import {
  selectCurrentProject,
  selectCurrentProjectUrl,
} from "../../project/selectors";
import { selectExperiments } from "../../../components/SimulationRunner/Controls/Experiments/selectors";
import { simulationProvider } from "./buildprovider";
import { trackEvents } from "../../analytics";

/**
 * Just using this to hide the casting away from the consumer. The casting is
 * necessary due to a bug in rxjs' typing.
 */
const toConnectable = <T>(
  observable: Observable<T>,
): ConnectableObservable<T> => observable.pipe(multicast(new Subject())) as any;

type ExperimentError = Error & { context?: string };
interface ExperimentWideSimulationErrorEvent {
  type: "experimentError";
  error: ExperimentError;
  simulationId: string;
}

type MappedExperimentStream =
  | ExperimentStreamResponse
  | ExperimentWideSimulationErrorEvent;

export const experimentError =
  (err: ExperimentError, experimentId: string): SimulatorThunk =>
  (dispatch) => {
    dispatch(experimentFailed(experimentId));

    // Check if no credits are remaining and throw the out-of-credits error modal
    if (err.message && err.message === "OutOfCredits") {
      appStore.dispatch(
        addUserAlert({
          context: "experiments.json",
          message: "Out of cloud compute credits",
          timestamp: Date.now(),
          type: "error",
          simulationId: null,
        }),
      );
    } else {
      appStore.dispatch(
        addUserAlert({
          context: err.context ?? "experiment.json",
          message: err.message ?? "running experiment failed",
          timestamp: Date.now(),
          type: "error",
          simulationId: null,
        }),
      );
    }
  };

/**
 * Unfortunately, groupBy's typings have a bug that fails to deal with
 * discriminated unions properly, which would make dealing with the various
 * events and their payloads extremely painful. This operators wraps it in order
 * to fix this with some typescript magic, and also hide it from the use site
 * as its kind of irrelevant to the actual operation of queuing experiments
 */
const groupExperimentStreamByType =
  () => (observable: Observable<MappedExperimentStream>) =>
    observable.pipe(
      groupBy((evt) => evt.type),
      map((group) => {
        type GroupName = typeof group extends GroupedObservable<infer Name, any>
          ? Name
          : never;
        type GroupType = typeof group extends GroupedObservable<any, infer Type>
          ? Type
          : never;

        type Union = {
          [Name in GroupName]: GroupedObservable<
            Name,
            Extract<GroupType, { type: Name }>
          >;
        }[GroupName];

        return group as any as Union;
      }),
    );

export const queueExperiment =
  (experimentName: string): SimulatorThunk<void> =>
  (dispatch, getState) => {
    const appState = appStore.getState();
    const project = selectCurrentProject(appState);
    const projectUrl = selectCurrentProjectUrl(appState);
    const experiments = Object.fromEntries(selectExperiments(appState) ?? []);
    const projectPath = project?.pathWithNamespace;
    const projectRef = project?.ref;

    if (!projectPath || !projectRef) {
      throw new Error("This project does not have a proper project path + ref");
    }

    const pendingExperimentId = uuid();

    /**
     * This isn't handled by addPendingExperiment because ExperimentGroup
     * won't render a pending experiment until 100ms after the experiment was
     * created and we don't want to deselect the currently selected experiment
     * until this experiment is ready to show
     */
    const selectExperiment = (() => {
      let selected = false;

      return () => {
        if (!selected) {
          selected = true;
          dispatch(setSelectedExperiment(pendingExperimentId));
        }
      };
    })();

    const selectExperimentTimeout = new Promise((resolve) => {
      setTimeout(resolve, EXPERIMENT_PENDING_THRESHOLD - 1);
    });

    // @todo most of these properties can be moved into the action
    const pendingStartedTime = Date.now();
    dispatch(
      addPendingExperiment({
        experimentId: pendingExperimentId,
        // should this be pending
        status: "queued",
        target: simulationProvider.target,
        startedTime: pendingStartedTime,
        experimentName,
        definition: experiments[experimentName],
      }),
    );

    // Track this this event and the associated runs
    const label = `${project?.name} - ${experimentName} - ${projectUrl}`;
    const context = { cloud: simulationProvider.target === "cloud" };

    const trackExperimentRunEvent = {
      action: "Experiment Run",
      label,
      context,
    };

    const simulationTrackingEvents = (simIds: string[]) =>
      simIds.map(() => ({
        action: "Experiment Simulation Run",
        label,
        context,
      }));

    const handleFailedPendingExperiment = (err: ExperimentError) =>
      dispatch(experimentError(err, pendingExperimentId));

    const experimentToQueue: ExperimentSrc = {
      experimentName,
      project: { path: projectPath, ref: projectRef },
      manifestSrc: JSON.stringify(createCompleteManifest(appState)),
      pyodideEnabled: pyodideEnabled(),
    };

    /**
     * Cloud experiments and local experiments currently use two different APIs –
     * we should rewrite the local experimenter to emit events as a stream like
     * the cloud experimenter, but until we do, we have to duplicate the handling
     * code unfortunately.
     *
     * @todo rewrite the local experimenter to avoid duplication
     */
    if (simulationProvider.target === "cloud") {
      let beforeQueuePromise = Promise.resolve();

      /**
       * Cloud also needs to be in-sync with current version, otherwise the
       * experiment defs will mismatch
       */
      if (selectScope[Scope.save](appState)) {
        beforeQueuePromise = beforeQueuePromise
          // @ts-expect-error redux
          .then(() => appStore.dispatch(parseAllBehaviorKeys()))
          .then(() => appStore.dispatch(save()))
          .then(() => {
            /**
             * This ensures the pending experiment appears above the
             * "recent changes" history item
             */
            dispatch(
              updatePendingExperimentTime({
                pendingId: pendingExperimentId,
                time: Date.now(),
              }),
            );
          });
      }

      /**
       * We're using a "connectable" observable because we want to be 100% sure we
       * only create a single subscription to the cloud websocket
       */
      const experimentObservable = toConnectable(
        from(beforeQueuePromise).pipe(
          mergeMap(
            () =>
              simulationProvider.queueExperiment(
                experimentToQueue,
              ) as Observable<ExperimentStreamResponse>,
          ),
        ),
      );

      /**
       * This creates a stream which will emit the queued event only – which we
       * will later map back to the full stream so that we can have the payload of
       * the queued event when handling future events
       */
      const queueEvent = experimentObservable.pipe(
        filter(
          (event): event is Extract<typeof event, { type: "queued" }> =>
            event.type === "queued",
        ),
        take(1),
      );

      const selectEvent = { type: "select" } as const;

      /**
       * We have a rule where if the experiment has not been queued within a
       * specified pending threshold, we will select (i.e, open) the experiment
       * whilst it is still pending (bearing in mind pending experiments don't
       * render before they've been selected, to prevent a multiple renders in
       * rapid succession. This race maps the single queue event into a pair of
       * select and queue events with the timing depending on how long it takes
       * to receive the queue event. This really demonstrates the power of RXJS.
       */
      const experimentEvent = race(
        from(selectExperimentTimeout).pipe(
          mergeMap(() => concat(of(selectEvent), queueEvent)),
        ),
        queueEvent.pipe(mergeMap((event) => from([selectEvent, event]))),
      ).pipe(
        /**
         * Both select and queued events only occur once, and don't need any info
         * outside of their own event to be handled. For convenience, I'm going to
         * handle these events here so that further down, I can just close over
         * the queued event rather than dealing with the side effects for that
         */
        tap((event) => {
          switch (event.type) {
            case "select":
              selectExperiment();
              break;

            case "queued":
              dispatch(
                initializeExperiment({
                  experiment: event.experiment,
                  pendingExperimentId,
                }),
              );
              // @ts-expect-error trackEvents
              appStore.dispatch(trackEvents([trackExperimentRunEvent]));
              break;
          }
        }),
        /**
         * We only want to close over the experiment later on, so lets filter for
         * the event containing it, and then map to the experiment within the
         * event
         */
        filter(
          (evt): evt is Extract<typeof evt, { type: "queued" }> =>
            evt.type === "queued",
        ),
        map((event) => event.experiment),
      );

      experimentEvent
        .pipe(
          /**
           * This catches any errors occurring whilst trying to select/queue an
           * experiment and dispatches the relevant events.
           */
          catchError((err) => {
            handleFailedPendingExperiment(err);

            /**
             * This ends the stream here, as a failure to queue an experiment is
             * a fatal error for experiments
             */
            return EMPTY;
          }),
          mergeMap((experiment) =>
            experimentObservable.pipe(
              /**
               * This catches any experiment-wide errors that occur *after* the
               * experiment has been queued. When this happens, we need to fail
               * any already created simulations, which we do by mapping it to a
               * stream of simulation-specific errors, which we follow up by
               * rethrowing the error itself to be caught later on, which will
               * fail the whole experiment for us. This avoids having to duplicate
               * the code handling simulation failures.
               */
              catchError(
                (err): Observable<ExperimentWideSimulationErrorEvent> => {
                  const state = getState();
                  const runs = selectExperimentRuns(state);
                  const simData = selectAllSimulationData(state);
                  const storeExperiment = runs[experiment.experimentId];

                  if (!storeExperiment) {
                    console.warn(
                      "Experiment is not yet in store, despite it being available. This should not happen",
                    );
                    return throwError(err);
                  }

                  const notYetCompleteErrors = storeExperiment.simulationIds
                    .filter(
                      (id) => !simData[id] || !simulationComplete(simData[id]),
                    )
                    .map((id) => ({
                      type: "experimentError" as const,
                      error: err,
                      simulationId: id,
                    }));

                  return concat(from(notYetCompleteErrors), throwError(err));
                },
              ),

              /**
               * From this point on, we want to partition the event stream by
               * event type, so that we can create different pipelines depending
               * on the event type (as some require further async logic). This
               * operator wraps rxjs' groupBy to hide some typescript magic.
               */
              groupExperimentStreamByType(),
              mergeMap((group) => {
                switch (group.key) {
                  case "simulationsCreated":
                    return group.pipe(
                      tap((event) => {
                        appStore.dispatch(
                          // @ts-expect-error trackEvents
                          trackEvents(
                            simulationTrackingEvents(Object.keys(event.plan)),
                          ),
                        );
                        dispatch(
                          experimentSimulationsCreated({
                            experimentId: experiment.experimentId,
                            plan: event.plan,
                          }),
                        );
                      }),
                    );

                  case "started":
                    return group.pipe(
                      tap((event) => {
                        dispatch(simulationRunStarted(event.simulationId));
                      }),
                    );

                  case "steps":
                    return group.pipe(
                      tap(({ status }) => {
                        dispatch(simulationRunUpdated(status));
                      }),
                    );

                  case "analysis":
                    return group.pipe(
                      tap((evt) => {
                        dispatch(simulationRunUpdated(evt.status));
                      }),
                      mergeMap(async (evt) => {
                        const simData =
                          selectAllSimulationData(getState())?.[
                            evt.simulationId
                          ];

                        if (!simData) {
                          throw new Error("Cannot find simulation");
                        }

                        try {
                          const data =
                            await historicCloudExperimentProvider.getAnalysis(
                              experiment,
                              {
                                ...simData,
                                analysisLink: evt.link,
                              },
                            );

                          return {
                            analysis: data,
                            simId: evt.simulationId,
                          };
                        } catch (err) {
                          console.error(err);
                          return {
                            analysis: null,
                            simId: evt.simulationId,
                          };
                        }
                      }),
                      tap((data) => {
                        if (data.analysis) {
                          dispatch(setSimulationAnalysis(data));
                        } else {
                          dispatch(
                            setSimulationStatus({
                              simId: data.simId,
                              status: "errored",
                            }),
                          );
                        }
                      }),
                    );

                  case "experimentError":
                  case "error":
                    /**
                     * Unfortunately, once we've created a discriminated union for
                     * the groups, we can't then easily operate on events of
                     * multiple types together – so we need to cast it back to
                     * a regular observable.
                     */
                    /* eslint-disable no-case-declarations */
                    const combinedGroup = group as Observable<
                      typeof group extends GroupedObservable<any, infer Type>
                        ? Type
                        : never
                    >;
                    /* eslint-enable no-case-declarations */

                    return combinedGroup.pipe(
                      tap(({ type, error, simulationId }) => {
                        // @todo reduce duplication with middleware
                        const message = error?.message ?? "error";
                        if (type === "error") {
                          appStore.dispatch(
                            addUserAlert({
                              type: "error",
                              message: message,
                              context: "",
                              timestamp: Date.now(),
                              simulationId: simulationId,
                            }),
                          );
                        }

                        // Make sure to update the runner status so the spinning bar goes away
                        dispatch(
                          simulationRunFailed({
                            simulationId: simulationId,
                            errorMessage: message,
                          }),
                        );
                      }),
                    );

                  case "stopping":
                    return group.pipe(
                      tap(() => {
                        dispatch(experimentStopping(experiment.experimentId));
                      }),
                    );

                  case "earlyStop":
                    return group.pipe(
                      tap((evt) => {
                        dispatch(
                          earlyStopSimulation(
                            evt.simulationId,
                            evt.status.stopMessage,
                          ),
                        );
                        dispatch(simulationRunUpdated(evt.status));
                      }),
                    );
                }

                return group;
              }),
              tap({
                complete() {
                  dispatch(experimentFinished(experiment.experimentId));
                },
              }),
              catchError((err) => {
                dispatch(experimentError(err, experiment.experimentId));

                return EMPTY;
              }),
            ),
          ),
        )
        .subscribe();

      // Actually trigger the connection to the websocket
      experimentObservable.connect();
    } else {
      const initialisePromise = simulationProvider.queueExperiment(
        experimentToQueue,
      ) as Promise<ExperimentRun & ExperimentPromises>;

      Promise.race([initialisePromise.catch(() => {}), selectExperimentTimeout])
        .then(selectExperiment)
        .then(() => initialisePromise)
        .then(
          /**
           * @todo rewrite this handler to be entirely stream based
           */
          async ({
            experimentPromise,
            runPromises,
            startedPromises,
            ...experiment
          }) => {
            dispatch(initializeExperiment({ experiment, pendingExperimentId }));
            dispatch(
              experimentSimulationsCreated({
                experimentId: experiment.experimentId,
                plan: experiment.plan,
              }),
            );

            const ids = experiment.simulationIds;
            appStore.dispatch(
              // @ts-expect-error trackEvents
              trackEvents([
                trackExperimentRunEvent,
                ...simulationTrackingEvents(ids),
              ]),
            );

            for (const [runId, promise] of Object.entries(startedPromises)) {
              promise.then(() => {
                return dispatch(simulationRunStarted(runId));
              });
            }

            // Tap in
            for (const [runId, run] of Object.entries(runPromises)) {
              run
                .then((status) => {
                  // @todo reduce duplication with middleware
                  if (status.runnerError) {
                    appStore.dispatch(
                      addUserAlert({
                        type: "error",
                        message: status.runnerError.message ?? "error",
                        context: "",
                        timestamp: Date.now(),
                        simulationId: runId,
                      }),
                    );
                  }

                  if (status.simulationRunId && status.earlyStop) {
                    dispatch(
                      earlyStopSimulation(
                        status.simulationRunId,
                        status.stopMessage,
                      ),
                    );
                  }

                  dispatch(simulationRunUpdated(status));
                })
                .catch((errorMessage: Error) => {
                  const message = errorMessage?.message ?? "error";
                  appStore.dispatch(
                    addUserAlert({
                      type: "error",
                      message: message,
                      context: "experiments.json",
                      timestamp: Date.now(),
                      simulationId: runId,
                    }),
                  );
                  // Make sure to update the runner status so the spinning bar goes away
                  dispatch(
                    simulationRunFailed({
                      simulationId: runId,
                      errorMessage: message,
                    }),
                  );
                });
            }
            return experimentPromise
              .catch(() => {})
              .then(() => {
                dispatch(experimentFinished(experiment.experimentId));
              });
          },
        )
        .catch(handleFailedPendingExperiment);
    }
  };
