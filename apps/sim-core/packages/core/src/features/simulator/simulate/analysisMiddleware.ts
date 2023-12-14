import { Middleware } from "@reduxjs/toolkit";
import { Observable, Subscription, combineLatest, defer, from, of } from "rxjs";
import {
  concatMap,
  dematerialize,
  distinctUntilChanged,
  filter,
  map,
  materialize,
  share,
  switchMap,
  tap,
} from "rxjs/operators";

import {
  OutputPlots,
  mutatingPlotData,
  mutatingUpdatePlotsForSingleRun,
  refreshAnalysisSource,
} from "../../../components/PlotViewer/analyze";
import type { SimulatorRootState, SimulatorStore } from "../types";
import { exhaustMapWithTrailing } from "../../../util/exhaustMapWithTrailing";
import { fromStore } from "../../../util/fromStore";
import { makeSelectAnalysisSelectorForSimIds } from "../../makeSelectAnalysisSelectorForSimIds";
import {
  selectAllSimulationData,
  selectAnalysisMode,
  selectAnalysisTabVisibleInSimulator,
  selectCurrentExperimentData,
  selectCurrentSimulationId,
  selectSimulationIdsForAnalysisMode,
} from "./selectors";
import { simulatorStore } from "../store";
import { store } from "../../store";
import { updatePlotData } from "./slice";

type AppStore = typeof store;
type PlotsOutputEntry = readonly [string, OutputPlots | null];

const createPlotsObservers = (
  simulatorStore: SimulatorStore,
  appStore: AppStore,
  simIds: string[],
  getExistingPlots?: () => Record<string, OutputPlots | null>,
): Observable<PlotsOutputEntry> => {
  const simObs = fromStore(simulatorStore);
  const appObs = fromStore(appStore);

  const selectAnalysisSelector = makeSelectAnalysisSelectorForSimIds(simIds);

  const analysisSrcObs = combineLatest([simObs, appObs]).pipe(
    map(
      ([simState, appState]) =>
        selectAnalysisSelector(appState)(simState).analysis,
    ),
    distinctUntilChanged(),
  );

  const emptyPlotsObs = analysisSrcObs.pipe(
    filter((src): src is string => typeof src === "string"),
    exhaustMapWithTrailing((analysisSrc) =>
      from(refreshAnalysisSource(analysisSrc)).pipe(
        materialize(),
        filter((val) => !val.error),
        dematerialize(),
      ),
    ),
    share(),
  );

  /**
   * @todo clear whenever analysis src changes
   */
  return emptyPlotsObs.pipe(
    switchMap((emptyPlots) =>
      defer(() => {
        const lastPlots: Record<string, OutputPlots | null> = JSON.parse(
          JSON.stringify(getExistingPlots?.() ?? {}),
        );

        return simObs.pipe(
          map(selectAllSimulationData),
          distinctUntilChanged(
            (prev, next) =>
              !simIds.some(
                (id) =>
                  prev[id]?.steps !== next[id]?.steps ||
                  prev[id]?.analysis !== next[id]?.analysis,
              ),
          ),
          exhaustMapWithTrailing((simulationData) =>
            of(...simIds).pipe(
              concatMap((id): Promise<PlotsOutputEntry> => {
                const plots: OutputPlots =
                  lastPlots[id] ?? JSON.parse(JSON.stringify(emptyPlots));

                const simData = simulationData[id];

                if (simData) {
                  if (simData.analysis?.outputs) {
                    plots.outputs = simData.analysis.outputs;

                    mutatingPlotData(
                      simData.analysis.outputs,
                      plots.plots,
                      Object.values(simData.analysis.outputs)[0]?.length ?? 0,
                    );

                    return Promise.resolve([id, plots]);
                  } else {
                    // @todo should take existing plots outputs
                    return mutatingUpdatePlotsForSingleRun(
                      simData.steps,
                      plots,
                      simData.stepsCount,
                    ).then((plots) => [id, plots] as const);
                  }
                } else {
                  return Promise.resolve([id, null] as const);
                }
              }),
            ),
          ),
          tap(([id, plots]) => {
            lastPlots[id] = plots;
          }),
          /**
           * We're cloning these objects on the way out because the originals
           * can be mutated by us and that needs to be invisible to the
           * consumer
           */
          map(
            ([id, plots]) => [id, JSON.parse(JSON.stringify(plots))] as const,
          ),
        );
      }),
    ),
  );
};

export const createSubscriptionToDispatchPlotData = (
  simIds: string[],
  getState: () => SimulatorRootState,
) =>
  createPlotsObservers(simulatorStore, store, simIds, () => {
    const simulationData = selectAllSimulationData(getState());

    return Object.fromEntries(
      simIds?.map((id) => [id, simulationData[id].plots]) ?? [],
    );
  }).pipe(
    tap(([simId, plots]) => {
      simulatorStore.dispatch(updatePlotData({ simId, plots }));
    }),
  );

/**
 * This could probably be two subscribers – one on the main store and one on
 * the simulator store thereby eliminating the sync.ts requirements for this
 * feature. I ran into issues with circular dependencies and this works, so
 * leaving it as a middleware for now
 *
 * @todo rewrite as a subscriber
 */
export const simulatorAnalysisMiddleware: Middleware<
  {},
  SimulatorRootState
> = ({ getState }) => {
  let subscription: Subscription | null = null;

  return (next) => {
    return (action) => {
      const prevState = getState();
      const res = next(action);
      const nextState = getState();

      const prevAnalysisVisible =
        selectAnalysisTabVisibleInSimulator(prevState);
      const nextAnalysisVisible =
        selectAnalysisTabVisibleInSimulator(nextState);

      const prevAnalysisMode = selectAnalysisMode(prevState);
      const nextAnalysisMode = selectAnalysisMode(nextState);
      const prevSimulation = selectCurrentSimulationId(prevState);
      const nextSimulation = selectCurrentSimulationId(nextState);
      const prevExperiment = selectCurrentExperimentData(prevState);
      const nextExperiment = selectCurrentExperimentData(nextState);

      if (
        !(
          prevAnalysisVisible === nextAnalysisVisible &&
          prevAnalysisMode === nextAnalysisMode &&
          prevSimulation === nextSimulation &&
          prevExperiment === nextExperiment
        )
      ) {
        if (subscription) {
          subscription.unsubscribe();
          subscription = null;
        }

        if (nextAnalysisVisible) {
          const simIds = selectSimulationIdsForAnalysisMode(nextState);

          if (simIds?.length) {
            subscription = createSubscriptionToDispatchPlotData(
              simIds,
              getState,
            ).subscribe();
          }
        }
      }

      return res;
    };
  };
};
