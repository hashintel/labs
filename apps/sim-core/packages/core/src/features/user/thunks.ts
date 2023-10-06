import { isEqual } from "lodash";

import type { AppThunk, AsyncAppThunk } from "../types";
import { Scope, selectScope } from "../scopes";
import type { TourProgress } from "../../util/api/types";
import { selectTourProgress } from "./selectors";
import { setLocalTourProgress } from "./local";
import { setTourProgress } from "./slice";
import { trackTourProgress } from "../../util/api";

const setTourProgressWithLocalStorage = (progress: TourProgress): AppThunk => (
  dispatch
) => {
  setLocalTourProgress(progress);
  dispatch(setTourProgress(progress));
};

export const tourProgress = (progress: TourProgress): AsyncAppThunk => async (
  dispatch,
  getState
) => {
  const state = getState();
  const prevProgress = selectTourProgress(state);
  const useAccount = selectScope[Scope.useAccount](state);

  /**
   * Bail if nothing has changed
   */
  if (isEqual(progress, prevProgress)) {
    return;
  }

  // Update state optimistically
  dispatch(setTourProgressWithLocalStorage(progress));

  if (useAccount) {
    try {
      await trackTourProgress(progress);
    } catch (errors) {
      console.debug({ errors });

      if (prevProgress) {
        // Revert back to the previous state prior to optimistically updating
        dispatch(setTourProgressWithLocalStorage(prevProgress));
      }
    }
  }
};
