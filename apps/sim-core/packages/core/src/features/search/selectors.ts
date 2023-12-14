import { createSelector, Selector } from "@reduxjs/toolkit";

import type { RootState } from "../types";
import type { SearchSlice } from "./types";

export const selectSearch: Selector<RootState, SearchSlice> = (state) =>
  state.search;

export const selectSearchOpen = createSelector(
  selectSearch,
  (search) => search.open,
);
