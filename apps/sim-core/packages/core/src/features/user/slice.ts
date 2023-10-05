import { createSlice, PayloadAction } from "@reduxjs/toolkit";

import type { BasicUser, TourProgress } from "../../util/api/types";
import { PartialSimulationProject } from "../project/types";
import type { UserSlice } from "./types";
import { bootstrapApp } from "../thunks";
import { getInitialState, removeAll, upsertMany, upsertOne } from "./adapter";
import { getLocalTourProgress } from "./local";

export const {
  reducer: userReducer,
  actions: {
    setTourProgress,
    setCloudCreditsRemaining,
    addUserProject,
    setBasicUser,
  },
} = createSlice({
  name: "user",
  initialState: getInitialState<UserSlice>({
    tourProgress: getLocalTourProgress(),
    isLoggedIn: false,
    currentUser: null,
    basicCurrentUser: null,
    projectsLoaded: false,
    bootstrapped: false,
    entities: {},
    ids: [],
  }),
  reducers: {
    setTourProgress(state, { payload }: PayloadAction<TourProgress>) {
      state.tourProgress = payload;
    },
    setCloudCreditsRemaining(state, { payload }: PayloadAction<number>) {
      if (state.currentUser === null) {
        throw new Error("Tried to set cloud credits, but current user is null");
      }

      state.currentUser.cloudCredits = payload;
    },
    addUserProject(
      state,
      { payload }: PayloadAction<PartialSimulationProject>
    ) {
      upsertOne(state, payload);
    },
    setBasicUser(state, { payload }: PayloadAction<BasicUser>) {
      state.isLoggedIn = true;
      state.basicCurrentUser = payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(bootstrapApp.fulfilled, (state, { payload }) => {
        if (payload.user) {
          state.currentUser = payload.user;
          state.tourProgress = payload.tourProgress;
          state.basicCurrentUser = payload.user;
          state.isLoggedIn = true;
        }

        if (payload.projects) {
          state.projectsLoaded = true;
          removeAll(state);
          upsertMany(state, payload.projects);
        }

        state.bootstrapped = true;
      })
      .addCase(bootstrapApp.rejected, (state, { error }) => {
        state.currentUser = null;
        state.basicCurrentUser = null;
        state.isLoggedIn = false;
        state.bootstrapped = false;
        state.tourProgress = null;

        throw error;
      });
  },
});
