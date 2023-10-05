import { createSlice, Draft, PayloadAction } from "@reduxjs/toolkit";
import { v4 as uuid } from "uuid";

import { TabKind } from "./enums";
import type { UserAlert, ViewerSlice } from "./types";
import { embeddableTabs, viewerTabs } from "./utils";
import { isCompleteErrorMessage } from "../utils";
import { newProcessChartValue } from "../../components/ProcessChart/utils";
import { setProject } from "../actions";

const setters = {
  openTab(state: Draft<ViewerSlice>, tab: TabKind) {
    setters.addTab(state, tab);
    state.currentTab = tab;
  },

  pushUserAlert(state: Draft<ViewerSlice>, alert: UserAlert) {
    const mappedAlert = { ...alert, uuid: uuid() };

    if (isCompleteErrorMessage(mappedAlert.message)) {
      mappedAlert.type = "complete";
      mappedAlert.message = "Simulation run complete";
      mappedAlert.context = "";
    }

    state.userAlerts.push(mappedAlert);
  },

  addTab(state: Draft<ViewerSlice>, tab: TabKind) {
    if (!state.visibleTabs.includes(tab)) {
      state.visibleTabs.push(tab);
    }
  },

  /**
   * @deprecated use openTab, which does the same by TabKind
   */
  changeTabByIndex(state: Draft<ViewerSlice>, index: number) {
    const clamped = Math.max(0, Math.min(state.visibleTabs.length - 1, index));
    state.currentTab = state.tabOrder.filter((tab) =>
      state.visibleTabs.includes(tab.kind)
    )[clamped]?.kind;
  },

  initializeTabs(
    state: Draft<ViewerSlice>,
    { tab, tabs }: { tab?: string | null; tabs?: string[] | null },
    allTabs: TabKind[],
    allowedTabs: TabKind[] = allTabs
  ) {
    const filteredTabs =
      tabs?.filter(valueIsTab).filter((tab) => allowedTabs.includes(tab)) ??
      ([] as TabKind[]);

    state.visibleTabs = filteredTabs.length ? filteredTabs : allTabs;

    if (valueIsTab(tab) && allowedTabs.includes(tab)) {
      setters.openTab(state, tab);
    } else {
      setters.openTab(state, state.visibleTabs[0]);
    }
  },
};

const viewerInitialState: ViewerSlice = {
  tabOrder: viewerTabs,
  currentTab: TabKind.ThreeD,
  currentProcessChart: newProcessChartValue,
  visibleTabs: [
    TabKind.ThreeD,
    TabKind.Geospatial,
    TabKind.Analysis,
    TabKind.RawOutput,
    TabKind.ProcessChart,
  ],
  userAlerts: [],
  editor: true,
  activity: true,
  embedded: false,
  viewer: true,
};

const tabValues = Object.values(TabKind) as string[];

const valueIsTab = (tab: any): tab is TabKind => tabValues.includes(tab);

export const {
  reducer: viewerReducer,
  actions: {
    /**
     * @deprecated use openTab which opens it by kind
     */
    changeTab,
    closeTab,
    openTab,
    addTab,
    addUserAlert,
    clearUserAlerts,
    initialiseView,
    hideActivity,
    showActivity,
    toggleActivity,
    toggleEditor,
    activateEmbedded,
    setProcessChart,
    toggleViewer,
  },
} = createSlice({
  name: "viewer",
  initialState: viewerInitialState,
  reducers: {
    /**
     * @deprecated use openTab which opens it by kind
     */
    changeTab: (state, action: PayloadAction<number>) =>
      setters.changeTabByIndex(state, action.payload),

    closeTab: (state, action: PayloadAction<TabKind>) => {
      const index = state.tabOrder
        .map((tab) => tab.kind)
        .filter((tab) => state.visibleTabs.includes(tab))
        .indexOf(action.payload);
      state.visibleTabs = state.visibleTabs.filter(
        (tab) => tab !== action.payload
      );
      if (state.currentTab === action.payload) {
        setters.changeTabByIndex(state, index);
      }
    },
    openTab: (state, action: PayloadAction<TabKind>) => {
      setters.openTab(state, action.payload);
    },
    addTab: (state, action: PayloadAction<TabKind>) =>
      setters.addTab(state, action.payload),

    addUserAlert: (state, action: PayloadAction<UserAlert>) => {
      setters.pushUserAlert(state, action.payload);
    },

    clearUserAlerts: (state) => {
      state.userAlerts = [];
    },

    toggleEditor(state) {
      state.editor = !state.editor;
    },

    hideActivity(state) {
      if (state.activity) {
        state.activity = false;
      }
    },

    showActivity(state) {
      if (!state.activity) {
        state.activity = true;
      }
    },

    toggleActivity(state) {
      if (state.viewer) {
        state.activity = !state.activity;
      }
    },

    toggleViewer(state) {
      state.viewer = !state.viewer;
    },

    initialiseView(
      state,
      action: PayloadAction<{
        activity?: boolean;
        editor?: boolean;
        viewer?: boolean;
        tab?: string | null;
        tabs?: string[] | null;
      }>
    ) {
      setters.initializeTabs(
        state,
        action.payload,
        state.visibleTabs,
        viewerTabs.map((tab) => tab.kind)
      );

      if (action.payload.editor !== undefined) {
        state.editor = action.payload.editor;
      }

      if (action.payload.activity !== undefined) {
        state.activity = action.payload.activity;
      }

      if (action.payload.viewer !== undefined) {
        state.viewer = action.payload.viewer;
      }
    },

    activateEmbedded(
      state,
      action: PayloadAction<{
        tabs?: string[] | null;
        tab?: string | null;
      }>
    ) {
      state.embedded = true;
      state.activity = false;
      state.editor = false;
      state.viewer = true;

      setters.initializeTabs(state, action.payload, embeddableTabs);
    },

    setProcessChart(state, action: PayloadAction<string>) {
      state.currentProcessChart = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(setProject, (state) => {
      state.userAlerts = [];
    });
  },
});
