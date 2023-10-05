/**
 * @todo tests
 */
import { createSlice } from "@reduxjs/toolkit";

import type { ExamplesSlice } from "./types";
import { bootstrapApp } from "../thunks";
import { getInitialState, removeAll, upsertMany } from "./adapter";

export const { reducer: examplesReducer } = createSlice({
  name: "examples",
  initialState: getInitialState<ExamplesSlice>({
    ids: [],
    entities: {},
    examplesLoaded: false,
  }),
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(bootstrapApp.fulfilled, (state, action) => {
      state.examplesLoaded = true;

      removeAll(state);
      upsertMany(state, action.payload.examples);
    });
  },
});
