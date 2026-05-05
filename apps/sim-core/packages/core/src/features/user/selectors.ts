import { createSelector, Selector } from "@reduxjs/toolkit";
import urljoin from "url-join";

import type { RootState } from "../types";
import { SITE_URL } from "../../util/api/paths";
import type { UserSlice } from "./types";
import { getSelectors } from "./adapter";

export const selectUserSlice: Selector<RootState, UserSlice> = (state) =>
  state.user;

export const selectBootstrapped = createSelector(
  selectUserSlice,
  (user) => user.bootstrapped,
);

export const selectCurrentUser = createSelector(
  selectUserSlice,
  (user) => user.currentUser,
);

export const selectUserProfileUrl = createSelector(selectCurrentUser, (user) =>
  user ? urljoin(SITE_URL, `@${user.shortname}`) : null,
);

export const selectUserImage = createSelector(
  selectCurrentUser,
  (user) => user?.image,
);

export const selectTourProgress = createSelector(
  selectUserSlice,
  (user) => user.tourProgress,
);

export const selectRemainingCloudCredits = createSelector(
  selectCurrentUser,
  (currentUser) => currentUser?.cloudCredits ?? 0,
);

export const selectUserProjects =
  getSelectors<RootState>(selectUserSlice).selectAll;

export const selectUserProjectsLoaded = createSelector(
  selectUserSlice,
  (slice) => slice.projectsLoaded,
);
