import { createSlice, Draft, PayloadAction } from "@reduxjs/toolkit";

import { Scope } from "../scopes";
import { SimulationProject } from "../project/types";
import { ToastKind } from "./enums";
import { ToastSlice } from "./types";
import { bootstrapApp } from "../thunks";
import { isProjectLatest } from "../project/utils";
import { setProject } from "../actions";

const toastInitialState: ToastSlice = {
  kind: ToastKind.None,
};

const setToast = (
  state: Draft<ToastSlice>,
  project: SimulationProject | null,
  canEdit: boolean,
  canWriteProject: boolean,
  fromLegacy = false,
) => {
  delete state.data;

  if (canEdit && project) {
    if (canWriteProject) {
      if (isProjectLatest(project)) {
        if (project.latestRelease) {
          state.kind = ToastKind.ProjectEditable;
        } else {
          state.kind = ToastKind.None;
        }
      } else {
        state.kind = ToastKind.ReadOnlyRelease;
      }
    } else {
      state.kind = ToastKind.ProjectPreview;
    }
  } else {
    state.kind = ToastKind.None;
  }

  // @todo this should preserve data
  if (fromLegacy) {
    state.data = state.kind;
    state.kind = ToastKind.LegacySimulationAccess;
  }
};

export const {
  reducer: toastReducer,
  actions: { displayToast },
} = createSlice({
  name: "toast",
  initialState: toastInitialState,
  reducers: {
    displayToast: (_, action: PayloadAction<ToastSlice>) => action.payload,
  },
  extraReducers: (builder) => {
    builder
      .addCase(setProject, (draft, action) => {
        const { project, meta, scopes } = action.payload;
        setToast(
          draft,
          project,
          scopes[Scope.edit],
          scopes[Scope.mutate],
          meta.fromLegacy ?? false,
        );
      })
      .addCase(bootstrapApp.fulfilled, (draft, action) => {
        setToast(
          draft,
          action.payload.currentProject,
          action.payload.scopes[Scope.edit],
          action.payload.scopes[Scope.mutate],
        );
      });
  },
});
