import { Store } from "@reduxjs/toolkit";

import { LinkableProject } from "../../project/types";
import { SimulatorDispatch, SimulatorRootState } from "../types";
import { store as appStore } from "../../store";
import { fetchProjectHistoryNextPage } from "./thunks";
import {
  selectCurrentProjectRequired,
  selectProjectAccess,
} from "../../project/selectors";
import {
  selectHistoryComplete,
  selectHistoryHasFilledScreen,
  selectHistoryProject,
  selectHistoryReady,
  selectHistoryRequestingMore,
  selectHistoryVisible,
} from "./selectors";

interface RunningState {
  running: boolean;
  abortController: AbortController;
  wasRequestingMore: boolean;
  requestingMore: boolean;
  historyProject: LinkableProject;
}

export const historySubscriber = (store: Store<SimulatorRootState>) => {
  const dispatch = store.dispatch as SimulatorDispatch;
  const run = async (runningState: RunningState, signal: AbortSignal) => {
    while (!signal.aborted) {
      await dispatch(
        fetchProjectHistoryNextPage(
          selectCurrentProjectRequired(appStore.getState()),
          selectProjectAccess(appStore.getState()),
          signal,
        ),
      );

      if (
        signal.aborted ||
        (runningState.wasRequestingMore && !runningState.requestingMore)
      ) {
        break;
      }
    }

    runningState.running = false;
  };

  let runningState: RunningState | null = null;

  return () => {
    const state = store.getState();
    const hasFilledScreen = selectHistoryHasFilledScreen(state);
    const complete = selectHistoryComplete(state);
    const requestingMore = selectHistoryRequestingMore(state);
    const ready = selectHistoryReady(state);
    const historyProject = selectHistoryProject(state);
    const visible = selectHistoryVisible(state);

    const shouldBeRunning =
      visible &&
      ready &&
      !complete &&
      historyProject &&
      (!runningState || runningState.historyProject === historyProject) &&
      (!hasFilledScreen || requestingMore || runningState?.wasRequestingMore);

    if (runningState) {
      runningState.requestingMore = requestingMore;

      if (!runningState.wasRequestingMore && requestingMore) {
        runningState.wasRequestingMore = true;
      }
    }

    if (shouldBeRunning) {
      if (!runningState?.running) {
        runningState?.abortController.abort();

        const abortController = new AbortController();
        runningState = {
          running: true,
          abortController,
          wasRequestingMore: requestingMore,
          requestingMore: requestingMore,
          historyProject: historyProject,
        };

        run(runningState, abortController.signal).catch((err) => {
          if (err.name !== "AbortError") {
            console.error(err);
          }
        });
      }
    } else {
      runningState?.abortController.abort();
      runningState = null;
    }
  };
};
