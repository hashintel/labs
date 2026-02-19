import React, { FC, useEffect, useRef } from "react";

import { TabKind } from "../../viewer/enums";
import { useFiles } from "../../files/FilesContext";
import { useProject } from "../../project/ProjectContext";
import { useViewer } from "../../viewer/ViewerContext";
import { simulatorStore } from "../store";
import {
  clearLocalPlotData,
  setAnalysisVisible,
  setCloudDisabled,
} from "./slice";
import { resetSimulationDataAndHistory, updateRunnerGlobals } from "./thunks";
import { selectRunning } from "./selectors";

/**
 * Replaces the old syncStores RxJS-based sync between the app Redux store
 * and the simulator Redux store. This component reads from app contexts and
 * dispatches to the simulator store when relevant values change.
 */
export const StoreSync: FC = () => {
  const { globalsSrc, analysisSrc } = useFiles();
  const { currentProject } = useProject();
  const { currentTab, clearUserAlerts, openTab } = useViewer();

  const prevProjectRef = useRef(currentProject);
  const prevGlobalsRef = useRef(globalsSrc);
  const prevTabRef = useRef(currentTab);
  const prevAnalysisRef = useRef(analysisSrc);

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

  return null;
};
