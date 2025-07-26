import { createSelector, Selector } from "@reduxjs/toolkit";

import type { ExamplesSlice } from "./types";
import type { RootState } from "../types";
import { getSelectors } from "./adapter";

const selectExamplesSlice: Selector<RootState, ExamplesSlice> = (state) =>
  state.examples;

export const selectExamples =
  getSelectors<RootState>(selectExamplesSlice).selectAll;

export const selectExamplesLoaded = createSelector(
  selectExamplesSlice,
  (examples) => examples.examplesLoaded,
);
