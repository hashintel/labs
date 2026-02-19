import { createSlice, PayloadAction } from "@reduxjs/toolkit";

import type { BasicUser, TourProgress } from "../../util/api/types";
import { PartialSimulationProject } from "../project/types";
import type { UserSlice } from "./types";
import { getLocalTourProgress } from "./local";

const initialState: UserSlice = {
  tourProgress: getLocalTourProgress(),
  isLoggedIn: false,
  currentUser: null,
  basicCurrentUser: null,
  projectsLoaded: false,
  bootstrapped: false,
  entities: {},
  ids: [],
};

export const {
  reducer: userReducer,
  actions: {
    setTourProgress,
    addUserProject,
    setBasicUser,
  },
} = createSlice({
  name: "user",
  initialState,
  reducers: {
    setTourProgress(state, { payload }: PayloadAction<TourProgress>) {
      state.tourProgress = payload;
    },
    addUserProject(
      state,
      { payload }: PayloadAction<PartialSimulationProject>
    ) {
      const id = payload.pathWithNamespace;
      if (!state.ids.includes(id)) {
        state.ids.push(id);
      }
      (state.entities as any)[id] = payload;
    },
    setBasicUser(state, { payload }: PayloadAction<BasicUser>) {
      state.isLoggedIn = true;
      state.basicCurrentUser = payload;
    },
  },
});
