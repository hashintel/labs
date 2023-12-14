import { createSelector, Selector } from "@reduxjs/toolkit";

import type { RootState } from "../types";
import type { ToastSlice } from "./types";

export const selectToast: Selector<RootState, ToastSlice> = (state) =>
  state.toast;

export const selectToastKind = createSelector(
  selectToast,
  (toast) => toast.kind,
);
export const selectToastData = createSelector(
  selectToast,
  (toast) => toast.data,
);
