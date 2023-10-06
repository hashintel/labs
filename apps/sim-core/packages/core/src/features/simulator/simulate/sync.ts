/**
 * We currently have two Redux stores, which is discouraged in most cases but
 * makes sense when we have one that is updated with extremely high frequency.
 * However, our second store needs to be able to respond to some changes in
 * state in the main store. This file is setup to sync between them, using rxJS
 */
import {
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  skip,
} from "rxjs/operators";
import { merge } from "rxjs";

import { AnalysisMode } from "./enum";
import { Scope, selectScope } from "../../scopes";
import { TabKind } from "../../viewer/enums";
import { store as appStore } from "../../store";
import {
  clearLocalPlotData,
  commitCreated,
  refetchHistory,
  releaseCreated,
  setAnalysisVisible,
  setCloudDisabled,
  showCollatedAnalysisForExperiment,
} from "./slice";
import { clearUserAlerts, openTab } from "../../viewer/slice";
import { exhaustMapWithTrailing } from "../../../util/exhaustMapWithTrailing";
import { fromStore } from "../../../util/fromStore";
import { projectChangeObservable } from "../../project/observables";
import { projectUpdated } from "../../actions";
import { release } from "../../project/slice";
import { resetSimulationDataAndHistory, updateRunnerGlobals } from "./thunks";
import { selectAnalysis, selectGlobals } from "../../files/selectors";
import {
  selectAnalysisMode,
  selectResetting,
  selectRunning,
} from "./selectors";
import { selectBootstrapped } from "../../user/selectors";
import { selectCurrentTab } from "../../viewer";
import { simulatorStore } from "../store";
import { simulatorStoreActionObservable } from "../actionObservable";
import { storeActionObservable } from "../../actionObservable";

type AppStore = typeof appStore;
type SimulatorStore = typeof simulatorStore;

export const syncStores = (
  appStore: AppStore,
  simulatorStore: SimulatorStore
) => {
  const appStoreObservable = fromStore(appStore);
  const simulationStoreObservable = fromStore(simulatorStore);

  projectChangeObservable(appStore).subscribe((projectUrl) => {
    simulatorStore.dispatch(
      resetSimulationDataAndHistory(
        projectUrl,
        selectAnalysis(appStore.getState())
      )
    );
  });

  appStoreObservable
    .pipe(
      map(selectGlobals),
      distinctUntilChanged(),
      filter((globals): globals is string => typeof globals === "string"),
      exhaustMapWithTrailing((globals) => {
        if (selectRunning(simulatorStore.getState())) {
          return simulatorStore.dispatch(updateRunnerGlobals(globals));
        }

        return Promise.resolve();
      })
    )
    .subscribe();

  appStoreObservable
    .pipe(map(selectCurrentTab), distinctUntilChanged())
    .subscribe((tab) => {
      simulatorStore.dispatch(setAnalysisVisible(tab === TabKind.Analysis));
    });

  appStoreObservable
    .pipe(map(selectAnalysis), distinctUntilChanged())
    .subscribe(() => {
      simulatorStore.dispatch(clearLocalPlotData());
    });

  appStoreObservable
    .pipe(
      filter((state) => selectBootstrapped(state)),
      map(selectScope[Scope.useCloud]),
      distinctUntilChanged()
    )
    .subscribe((canUseCloud) => {
      simulatorStore.dispatch(setCloudDisabled(!canUseCloud));
    });

  appStoreObservable
    .pipe(
      filter((state) => selectBootstrapped(state)),
      map(selectScope[Scope.useAccount]),
      distinctUntilChanged(),
      skip(1)
    )
    .subscribe(() => {
      simulatorStore.dispatch(refetchHistory());
    });

  simulationStoreObservable
    .pipe(
      skip(1),
      map(selectResetting),
      distinctUntilChanged(),
      filter((resetting) => resetting)
    )
    .subscribe(() => {
      appStore.dispatch(clearUserAlerts());
    });

  merge(
    simulatorStoreActionObservable.pipe(
      filter((action) => showCollatedAnalysisForExperiment.match(action))
    ),
    simulationStoreObservable.pipe(
      map(selectAnalysisMode),
      distinctUntilChanged(),
      filter((mode) => !!mode && mode !== AnalysisMode.SingleRun)
    )
  )
    .pipe(debounceTime(0))
    .subscribe(() => {
      appStore.dispatch(openTab(TabKind.Analysis));
    });

  storeActionObservable
    .pipe(filter(release.fulfilled.match))
    .subscribe((action) => {
      simulatorStore.dispatch(releaseCreated(action.payload));
    });

  storeActionObservable
    .pipe(filter(projectUpdated.match))
    .subscribe((action) => {
      if (action.payload.commit) {
        simulatorStore.dispatch(
          commitCreated({
            createdAt: new Date(action.payload.updatedAt).getTime(),
            commit: action.payload.commit,
          })
        );
      }
    });
};
