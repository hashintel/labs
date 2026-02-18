import { useEffect, useMemo } from "react";

import { TabKind } from "../features/viewer/enums";
import { getSafeQueryParams } from "../util/getSafeQueryParams";
import { useViewer } from "../features/viewer/ViewerContext";

export const getUiQueryParams = () => {
  const {
    view = TabKind.ThreeD,
    editor = true,
    activity = true,
    viewer = true,
    tabs = null,
  } = getSafeQueryParams();

  return {
    view: view === "plots" ? TabKind.Analysis : (view as string),
    editor: editor !== "false",
    activity: activity !== "false",
    viewer: viewer !== "false",
    tabs: typeof tabs === "string" ? tabs.split(",") : null,
  };
};

export const useParameterisedUi = () => {
  const { view, editor, activity, tabs, viewer } = useMemo(
    getUiQueryParams,
    []
  );
  const { initialiseView } = useViewer();

  useEffect(() => {
    initialiseView({
      tab: view,
      editor,
      activity,
      tabs,
      viewer,
    });
  }, [activity, initialiseView, editor, tabs, view, viewer]);
};
