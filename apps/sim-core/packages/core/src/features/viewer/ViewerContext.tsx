import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from "react";
import { v4 as uuid } from "uuid";

import { TabKind } from "./enums";
import type { UserAlert, UserAlertInState, ViewerTab } from "./types";
import { embeddableTabs, viewerTabs } from "./utils";
import { isCompleteErrorMessage } from "../utils";
import { newProcessChartValue } from "../../components/ProcessChart/utils";

// ---------------------- State shape ----------------------

interface ViewerState {
  tabOrder: ViewerTab[];
  currentTab: TabKind;
  currentProcessChart: string;
  visibleTabs: TabKind[];
  userAlerts: UserAlertInState[];
  editor: boolean;
  activity: boolean;
  embedded: boolean;
  viewer: boolean;
}

const initialState: ViewerState = {
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

// ---------------------- Actions ----------------------

type ViewerAction =
  | { type: "changeTab"; index: number }
  | { type: "closeTab"; tab: TabKind }
  | { type: "openTab"; tab: TabKind }
  | { type: "addTab"; tab: TabKind }
  | { type: "addUserAlert"; alert: UserAlert }
  | { type: "clearUserAlerts" }
  | { type: "toggleEditor" }
  | { type: "hideActivity" }
  | { type: "showActivity" }
  | { type: "toggleActivity" }
  | { type: "toggleViewer" }
  | {
      type: "initialiseView";
      payload: {
        activity?: boolean;
        editor?: boolean;
        viewer?: boolean;
        tab?: string | null;
        tabs?: string[] | null;
      };
    }
  | {
      type: "activateEmbedded";
      payload: { tabs?: string[] | null; tab?: string | null };
    }
  | { type: "setProcessChart"; value: string }
  | { type: "projectChanged" };

// ---------------------- Helpers ----------------------

const tabValues = Object.values(TabKind) as string[];
const valueIsTab = (tab: any): tab is TabKind => tabValues.includes(tab);

function addTab(state: ViewerState, tab: TabKind): ViewerState {
  if (state.visibleTabs.includes(tab)) return state;
  return { ...state, visibleTabs: [...state.visibleTabs, tab] };
}

function openTab(state: ViewerState, tab: TabKind): ViewerState {
  const s = addTab(state, tab);
  return { ...s, currentTab: tab };
}

function changeTabByIndex(state: ViewerState, index: number): ViewerState {
  const clamped = Math.max(0, Math.min(state.visibleTabs.length - 1, index));
  const kind = state.tabOrder.filter((t) =>
    state.visibleTabs.includes(t.kind),
  )[clamped]?.kind;
  return kind ? { ...state, currentTab: kind } : state;
}

function initializeTabs(
  state: ViewerState,
  opts: { tab?: string | null; tabs?: string[] | null },
  allTabs: TabKind[],
  allowedTabs: TabKind[] = allTabs,
): ViewerState {
  const filtered =
    opts.tabs?.filter(valueIsTab).filter((t) => allowedTabs.includes(t)) ?? [];
  const visibleTabs = filtered.length ? filtered : allTabs;
  let s = { ...state, visibleTabs };
  if (valueIsTab(opts.tab) && allowedTabs.includes(opts.tab)) {
    s = openTab(s, opts.tab);
  } else {
    s = openTab(s, visibleTabs[0]);
  }
  return s;
}

// ---------------------- Reducer ----------------------

function viewerReducer(state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case "changeTab":
      return changeTabByIndex(state, action.index);
    case "closeTab": {
      const idx = state.tabOrder
        .map((t) => t.kind)
        .filter((t) => state.visibleTabs.includes(t))
        .indexOf(action.tab);
      const vis = state.visibleTabs.filter((t) => t !== action.tab);
      let s = { ...state, visibleTabs: vis };
      if (state.currentTab === action.tab) s = changeTabByIndex(s, idx);
      return s;
    }
    case "openTab":
      return openTab(state, action.tab);
    case "addTab":
      return addTab(state, action.tab);
    case "addUserAlert": {
      const mapped: UserAlertInState = { ...action.alert, uuid: uuid() };
      if (isCompleteErrorMessage(mapped.message)) {
        mapped.type = "complete";
        mapped.message = "Simulation run complete";
        mapped.context = "";
      }
      return { ...state, userAlerts: [...state.userAlerts, mapped] };
    }
    case "clearUserAlerts":
      return { ...state, userAlerts: [] };
    case "toggleEditor":
      return { ...state, editor: !state.editor };
    case "hideActivity":
      return state.activity ? { ...state, activity: false } : state;
    case "showActivity":
      return !state.activity ? { ...state, activity: true } : state;
    case "toggleActivity":
      return state.viewer
        ? { ...state, activity: !state.activity }
        : state;
    case "toggleViewer":
      return { ...state, viewer: !state.viewer };
    case "initialiseView": {
      let s = initializeTabs(
        state,
        action.payload,
        state.visibleTabs,
        viewerTabs.map((t) => t.kind),
      );
      if (action.payload.editor !== undefined)
        s = { ...s, editor: action.payload.editor };
      if (action.payload.activity !== undefined)
        s = { ...s, activity: action.payload.activity };
      if (action.payload.viewer !== undefined)
        s = { ...s, viewer: action.payload.viewer };
      return s;
    }
    case "activateEmbedded": {
      let s: ViewerState = {
        ...state,
        embedded: true,
        activity: false,
        editor: false,
        viewer: true,
      };
      return initializeTabs(s, action.payload, embeddableTabs);
    }
    case "setProcessChart":
      return { ...state, currentProcessChart: action.value };
    case "projectChanged":
      return { ...state, userAlerts: [] };
    default:
      return state;
  }
}

// ---------------------- Context ----------------------

export interface ViewerContextValue {
  currentTab: TabKind;
  currentProcessChart: string;
  visibleTabs: TabKind[];
  visibleTabsInOrder: ViewerTab[];
  userAlerts: UserAlertInState[];
  editorVisible: boolean;
  activityVisible: boolean;
  viewerVisible: boolean;
  embedded: boolean;

  changeTab: (index: number) => void;
  closeTab: (tab: TabKind) => void;
  openTab: (tab: TabKind) => void;
  addTab: (tab: TabKind) => void;
  addUserAlert: (alert: UserAlert) => void;
  clearUserAlerts: () => void;
  toggleEditor: () => void;
  hideActivity: () => void;
  showActivity: () => void;
  toggleActivity: () => void;
  toggleViewer: () => void;
  initialiseView: (payload: {
    activity?: boolean;
    editor?: boolean;
    viewer?: boolean;
    tab?: string | null;
    tabs?: string[] | null;
  }) => void;
  activateEmbedded: (payload: {
    tabs?: string[] | null;
    tab?: string | null;
  }) => void;
  setProcessChart: (value: string) => void;
  onProjectChanged: () => void;
}

const ViewerContext = createContext<ViewerContextValue | null>(null);

export const useViewer = () => {
  const ctx = useContext(ViewerContext);
  if (!ctx) throw new Error("useViewer must be inside ViewerProvider");
  return ctx;
};

export const ViewerProvider: FC<PropsWithChildren> = ({ children }) => {
  const [state, dispatch] = useReducer(viewerReducer, initialState);

  const changeTab = useCallback(
    (index: number) => dispatch({ type: "changeTab", index }),
    [],
  );
  const closeTabAction = useCallback(
    (tab: TabKind) => dispatch({ type: "closeTab", tab }),
    [],
  );
  const openTabAction = useCallback(
    (tab: TabKind) => dispatch({ type: "openTab", tab }),
    [],
  );
  const addTabAction = useCallback(
    (tab: TabKind) => dispatch({ type: "addTab", tab }),
    [],
  );
  const addUserAlert = useCallback(
    (alert: UserAlert) => dispatch({ type: "addUserAlert", alert }),
    [],
  );
  const clearUserAlerts = useCallback(
    () => dispatch({ type: "clearUserAlerts" }),
    [],
  );
  const toggleEditor = useCallback(
    () => dispatch({ type: "toggleEditor" }),
    [],
  );
  const hideActivity = useCallback(
    () => dispatch({ type: "hideActivity" }),
    [],
  );
  const showActivity = useCallback(
    () => dispatch({ type: "showActivity" }),
    [],
  );
  const toggleActivity = useCallback(
    () => dispatch({ type: "toggleActivity" }),
    [],
  );
  const toggleViewer = useCallback(
    () => dispatch({ type: "toggleViewer" }),
    [],
  );
  const initialiseView = useCallback(
    (payload: {
      activity?: boolean;
      editor?: boolean;
      viewer?: boolean;
      tab?: string | null;
      tabs?: string[] | null;
    }) => dispatch({ type: "initialiseView", payload }),
    [],
  );
  const activateEmbedded = useCallback(
    (payload: { tabs?: string[] | null; tab?: string | null }) =>
      dispatch({ type: "activateEmbedded", payload }),
    [],
  );
  const setProcessChart = useCallback(
    (value: string) => dispatch({ type: "setProcessChart", value }),
    [],
  );
  const onProjectChanged = useCallback(
    () => dispatch({ type: "projectChanged" }),
    [],
  );

  const visibleTabsInOrder = useMemo(
    () => viewerTabs.filter((t) => state.visibleTabs.includes(t.kind)),
    [state.visibleTabs],
  );

  const activityVisible = state.activity && state.viewer;

  const value = useMemo<ViewerContextValue>(
    () => ({
      currentTab: state.currentTab,
      currentProcessChart: state.currentProcessChart,
      visibleTabs: state.visibleTabs,
      visibleTabsInOrder,
      userAlerts: state.userAlerts,
      editorVisible: state.editor,
      activityVisible,
      viewerVisible: state.viewer,
      embedded: state.embedded,
      changeTab,
      closeTab: closeTabAction,
      openTab: openTabAction,
      addTab: addTabAction,
      addUserAlert,
      clearUserAlerts,
      toggleEditor,
      hideActivity,
      showActivity,
      toggleActivity,
      toggleViewer,
      initialiseView,
      activateEmbedded,
      setProcessChart,
      onProjectChanged,
    }),
    [
      state.currentTab,
      state.currentProcessChart,
      state.visibleTabs,
      visibleTabsInOrder,
      state.userAlerts,
      state.editor,
      activityVisible,
      state.viewer,
      state.embedded,
      changeTab,
      closeTabAction,
      openTabAction,
      addTabAction,
      addUserAlert,
      clearUserAlerts,
      toggleEditor,
      hideActivity,
      showActivity,
      toggleActivity,
      toggleViewer,
      initialiseView,
      activateEmbedded,
      setProcessChart,
      onProjectChanged,
    ],
  );

  return (
    <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>
  );
};
