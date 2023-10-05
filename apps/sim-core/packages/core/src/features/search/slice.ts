import { createSlice } from "@reduxjs/toolkit";

import type { SearchSlice } from "./types";

const initialState: SearchSlice = {
  open: false,
};

export const {
  reducer: searchReducer,
  actions: { openSearch, closeSearch },
} = createSlice({
  name: "search",
  initialState,
  reducers: {
    openSearch(state) {
      state.open = true;
    },
    closeSearch(state) {
      state.open = false;
    },
  },
});
