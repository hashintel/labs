import { createSelector, Selector } from "@reduxjs/toolkit";

import type { RootState } from "../types";
import type { ViewerSlice } from "./types";
import { viewerTabs } from "./utils";

export const getViewer: Selector<RootState, ViewerSlice> = (state) =>
  state.viewer;

export const selectCurrentTab = createSelector(
  getViewer,
  (viewer) => viewer.currentTab
);

export const selectVisibleTabs = createSelector(
  getViewer,
  (viewer) => viewer.visibleTabs
);

export const selectVisibleTabsInOrder = createSelector(
  [selectVisibleTabs],
  (visibleTabs) => viewerTabs.filter((tab) => visibleTabs.includes(tab.kind))
);

export const selectUserAlerts = createSelector(
  getViewer,
  (viewer) => viewer.userAlerts
);

export const selectCurrentProcessChart = createSelector(
  getViewer,
  (viewer) => viewer.currentProcessChart
);

/**
 * @deprecated
 * @todo replace with scopes
 */
export const selectEditorVisible = createSelector(
  getViewer,
  (viewer) => viewer.editor
);

export const selectViewerVisible = createSelector(
  getViewer,
  (viewer) => viewer.viewer
);

/**
 * @deprecated
 * @todo replace with scopes
 */
export const selectActivityVisible = createSelector(
  [getViewer, selectViewerVisible],
  (viewer, viewerVisible) => viewer.activity && viewerVisible
);

/**
 * @deprecated
 * @todo replace with scopes
 */
export const selectEmbedded = createSelector(
  getViewer,
  (viewer) => viewer.embedded
);
