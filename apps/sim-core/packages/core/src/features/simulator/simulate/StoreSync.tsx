import { FC, useCallback, useEffect, useRef } from "react";

import { TabKind } from "../../viewer/enums";
import { useFiles } from "../../files/FilesContext";
import { useProject } from "../../project/ProjectContext";
import { useViewer } from "../../viewer/ViewerContext";
import { appBridge } from "../appBridge";
import { simulatorStore } from "../store";
import {
  clearLocalPlotData,
  setAnalysisVisible,
  setCloudDisabled,
} from "./slice";
import { resetSimulationDataAndHistory, updateRunnerGlobals } from "./thunks";
import { selectRunning } from "./selectors";
import { selectAllFilesLocal } from "../../files/selectors";
import { setLocalStorageProject } from "../../middleware/localStorage";

/**
 * Replaces the old syncStores RxJS-based sync between the app Redux store
 * and the simulator Redux store. This component reads from app contexts and
 * dispatches to the simulator store when relevant values change.
 *
 * Also keeps the appBridge in sync so that non-React simulator code can
 * read the latest app state.
 */
export const StoreSync: FC = () => {
  const { globalsSrc, analysisSrc, filesState } = useFiles();
  const { currentProject, projectLoaded } = useProject();
  const { currentTab, editorVisible, addUserAlert, clearUserAlerts, openTab } =
    useViewer();

  const prevProjectRef = useRef(currentProject);
  const prevGlobalsRef = useRef(globalsSrc);
  const prevTabRef = useRef(currentTab);
  const prevAnalysisRef = useRef(analysisSrc);

  useEffect(() => {
    appBridge.setState({
      files: filesState,
      project: {
        currentProject,
        projectLoaded,
        accessGate: null,
        pendingProject: null,
      },
      viewer: {
        editor: editorVisible,
        currentTab,
      },
    });
  }, [filesState, currentProject, projectLoaded, editorVisible, currentTab]);

  useEffect(() => {
    appBridge.dispatchUserAlert = (alert) => addUserAlert(alert);
    appBridge.dispatchClearUserAlerts = () => clearUserAlerts();
    appBridge.dispatchOpenTab = (tab) => openTab(tab);
  }, [addUserAlert, clearUserAlerts, openTab]);

  useEffect(() => {
    if (prevProjectRef.current !== currentProject && currentProject) {
      simulatorStore.dispatch(
        resetSimulationDataAndHistory(
          currentProject,
          prevAnalysisRef.current ?? null,
        ) as any,
      );
    }
    prevProjectRef.current = currentProject;
  }, [currentProject]);

  useEffect(() => {
    if (prevGlobalsRef.current !== globalsSrc && globalsSrc) {
      const state = simulatorStore.getState();
      if (selectRunning(state)) {
        simulatorStore.dispatch(updateRunnerGlobals(globalsSrc) as any);
      }
    }
    prevGlobalsRef.current = globalsSrc;
  }, [globalsSrc]);

  useEffect(() => {
    if (prevTabRef.current !== currentTab) {
      simulatorStore.dispatch(
        setAnalysisVisible(currentTab === TabKind.Analysis),
      );
    }
    prevTabRef.current = currentTab;
  }, [currentTab]);

  useEffect(() => {
    if (prevAnalysisRef.current !== analysisSrc) {
      simulatorStore.dispatch(clearLocalPlotData());
    }
    prevAnalysisRef.current = analysisSrc;
  }, [analysisSrc]);

  useEffect(() => {
    simulatorStore.dispatch(setCloudDisabled(true));
  }, []);

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistProject = useCallback(() => {
    if (!currentProject) return;
    const allFiles = selectAllFilesLocal(filesState);
    const actions = filesState.actions ?? [];
    setLocalStorageProject({
      ...currentProject,
      files: allFiles,
      actions,
    });
  }, [currentProject, filesState]);

  useEffect(() => {
    if (!currentProject) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(persistProject, 500);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [filesState, currentProject, persistProject]);

  return null;
};
