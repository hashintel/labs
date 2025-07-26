import { useEffect, useMemo } from "react";
import { useDispatch } from "react-redux";

import { TabKind } from "../features/viewer/enums";
import { getSafeQueryParams } from "../util/getSafeQueryParams";
import { initialiseView } from "../features/viewer/slice";

export const getUiQueryParams = () => {
  const {
    view = TabKind.ThreeD,
    editor = true,
    activity = true,
    viewer = true,
    tabs = null,
  } = getSafeQueryParams();

  return {
    view: view === "plots" ? TabKind.Analysis : view,
    editor: editor !== "false",
    activity: activity !== "false",
    viewer: viewer !== "false",
    tabs: typeof tabs === "string" ? tabs.split(",") : null,
  };
};

export const useParameterisedUi = () => {
  // We don't want these to respond to changes
  const { view, editor, activity, tabs, viewer } = useMemo(
    getUiQueryParams,
    [],
  );
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(
      initialiseView({
        tab: view,
        editor,
        activity,
        tabs,
        viewer,
      }),
    );
  }, [activity, dispatch, editor, tabs, view, viewer]);
};
