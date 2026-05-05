import { Middleware } from "@reduxjs/toolkit";

import type { AppDispatch, RootState } from "../types";
import { TabKind } from "../viewer/enums";
import { analysisFileId } from "../files/utils";
import { openTab } from "../viewer/slice";
import { selectCurrentFileId } from "../files/selectors";

// Purpose: When selecting the analysis.json file, we want the users to focus the Analysis tab
export const analysisMiddleware: Middleware<{}, RootState> = (store) => {
  const dispatch = store.dispatch as AppDispatch;

  return (next) => (action) => {
    const beforeFileId = selectCurrentFileId(store.getState());
    const result = next(action);
    const currentFileId = selectCurrentFileId(store.getState());
    if (beforeFileId !== currentFileId && currentFileId === analysisFileId) {
      dispatch(openTab(TabKind.Analysis));
    }
    return result;
  };
};
