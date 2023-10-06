import { combineReducers } from "@reduxjs/toolkit";

import { examplesReducer } from "./examples/slice";
import { filesReducer } from "./files/slice";
import { projectReducer } from "./project/slice";
import { searchReducer } from "./search/slice";
import { toastReducer } from "./toast/slice";
import { userReducer } from "./user/slice";
import { viewerReducer } from "./viewer/slice";

export const rootReducer = combineReducers({
  examples: examplesReducer,
  files: filesReducer,
  project: projectReducer,
  search: searchReducer,
  toast: toastReducer,
  user: userReducer,
  viewer: viewerReducer,
});

export type RootReducerType = typeof rootReducer;
