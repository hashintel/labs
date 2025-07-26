import React, { FC, memo, ReactElement, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Tab, TabPanel } from "react-tabs";
import classNames from "classnames";
import { SerializableAgentState } from "@hashintel/engine-web";
import { editor } from "monaco-editor";

import { AgentScene } from "./AgentSceneLazy";
import { AnalysisViewer } from "./AnalysisViewerLazy";
import type { AppDispatch } from "../../features/types";
import { GeospatialMap } from "./GeospatialMapLazy";
import { IconClose } from "../Icon";
import { MonacoContainer } from "../MonacoContainer";
import { ProcessChart } from "../ProcessChart/ProcessChart";
import { SimulationViewerPyodideIndicator } from "./PyodideIndicator";
import type { SimulatorRootState } from "../../features/simulator/types";
import { StepExplorer } from "./StepExplorerLazy";
import { TabActionBar } from "../TabActionBar/TabActionBar";
import { TabKind } from "../../features/viewer/enums";
import {
  TabbedEditorPanel,
  restoreEditorState,
  useMonacoContainer,
} from "../TabbedEditor";
import { changeTab, closeTab } from "../../features/viewer/slice";
import { getUiQueryParams } from "../../hooks/useParameterisedUi";
import { lazyTabs } from "./lazy";
import { pyodideEnabled } from "../../util/pyodideEnabled";
import {
  selectCurrentExperimentData,
  selectCurrentRunnerSteps,
  selectCurrentSimErrored,
  selectCurrentSimulationId,
  selectCurrentStep,
  selectPyodideStatus,
  selectResetting,
  selectRunning,
} from "../../features/simulator/simulate/selectors";
import {
  selectCurrentTab,
  selectEmbedded,
  selectVisibleTabsInOrder,
} from "../../features/viewer/selectors";
import { useHandlePromiseRejection } from "../ErrorBoundary";
import { useSimulatorSelector } from "../../features/simulator/context";

interface TabEl {
  el: (selected: boolean) => ReactElement | null;
  forceRender?: boolean;
  onSelected?: () => void;
}

const makeSelectStep = (currentStep: number) => (state: SimulatorRootState) =>
  selectCurrentRunnerSteps(state)[currentStep];

const useRawOutputTextModel = () => {
  const textModelRef = useRef<editor.ITextModel | null>(null);

  if (textModelRef.current === null) {
    textModelRef.current = editor.createModel("[]", "json");
  }

  useEffect(() => {
    return () => {
      textModelRef.current!.dispose();
    };
  }, []);

  return textModelRef.current;
};

const getLazyTab = (tab: TabKind | string) =>
  (lazyTabs as Partial<Record<any, (typeof lazyTabs)[TabKind]>>)[tab];

const loadTab = async (tab: TabKind | string) => {
  const tabFactory = getLazyTab(tab);

  if (tabFactory) {
    try {
      await tabFactory();
    } catch (err) {
      console.error(err);
      throw new Error("Could not load tab");
    }
  }
};

/**
 * @todo move this into the React rendering process
 */
const view = getUiQueryParams().view;
const initialTab = loadTab(getLazyTab(view) ? view : TabKind.ThreeD);

const serializeRawOutput = (
  viewingStep: SerializableAgentState[] | undefined | null,
) => JSON.stringify(viewingStep ?? [], null, 2);

export const SimulationViewer: FC = memo(function SimulationViewer() {
  const currentStep = useSimulatorSelector(selectCurrentStep);
  const simId = useSimulatorSelector(selectCurrentSimulationId);
  const pyodideStatus = useSimulatorSelector(selectPyodideStatus);
  const running = useSimulatorSelector(selectRunning);
  const viewingStep = useSimulatorSelector(makeSelectStep(currentStep));
  const resetting = useSimulatorSelector(selectResetting);
  const errored = useSimulatorSelector(selectCurrentSimErrored);
  const currentExperiment = useSimulatorSelector(selectCurrentExperimentData);

  const dispatch = useDispatch<AppDispatch>();

  const [editorInstance, monacoContainerRef] = useMonacoContainer();

  const selectedTab = useSelector(selectCurrentTab);
  const embedded = useSelector(selectEmbedded);
  const visibleTabs = useSelector(selectVisibleTabsInOrder);
  const selectedTabIndex = visibleTabs
    .map((tab) => tab.kind)
    .indexOf(selectedTab);

  const pyodide = pyodideEnabled();

  const rawOutputTextModel = useRawOutputTextModel();
  const handlePromiseRejection = useHandlePromiseRejection();

  useEffect(() => {
    const abortController = new AbortController();

    handlePromiseRejection(
      initialTab.then(async () => {
        if (!abortController.signal.aborted) {
          await Promise.all(visibleTabs.map((tab) => loadTab(tab.kind)));
        }
      }),
    );

    return () => {
      abortController.abort();
    };
  }, [visibleTabs, handlePromiseRejection]);

  const tabsRef = useRef<HTMLElement | null>(null);

  function handleTabSelect(tabIndex: number, last: number, event: Event) {
    // We assume tab changes are produced only by buttons/elements
    const target = event.target as Element;

    // We need to filter out for tab changes only on the tabs we make
    // This is a bug in react tabs where sub tabs trigger changes on the parent
    // https://github.com/reactjs/react-tabs/issues/237
    // @todo we should move this functionality into TabActionBar
    if (target.className === "react-tabs__tab") {
      dispatch(changeTab(tabIndex));

      const { onSelected } = tabs[visibleTabs[tabIndex].kind];
      if (onSelected) {
        onSelected();
      }
    }
  }

  const tabs: Record<TabKind, TabEl> = {
    [TabKind.ThreeD]: {
      el(selected: boolean) {
        return (
          <AgentScene
            simulationRunId={simId}
            simulationStep={viewingStep}
            properties={{}}
            simulating={running}
            visible={selected}
            resetting={resetting}
            errored={errored}
          />
        );
      },
      forceRender: true,
    },
    [TabKind.Geospatial]: {
      el(selected) {
        return (
          <GeospatialMap
            simulationStep={viewingStep}
            visible={selected}
            simulationId={simId}
            errored={errored}
          />
        );
      },
    },
    [TabKind.Analysis]: {
      el(selected) {
        return <AnalysisViewer currentStep={currentStep} visible={selected} />;
      },
    },
    [TabKind.ProcessChart]: {
      el: () => <ProcessChart />,
    },
    [TabKind.RawOutput]: {
      el: () => (
        <TabbedEditorPanel
          editorInstance={editorInstance}
          textModel={rawOutputTextModel}
        />
      ),
      onSelected: () => {
        if (!editorInstance) {
          return;
        }

        rawOutputTextModel.setValue(serializeRawOutput(viewingStep));
        restoreEditorState(editorInstance, rawOutputTextModel, undefined, {
          readOnly: true,
        });
      },
    },
    [TabKind.StepExplorer]: {
      el: (selected: boolean) => {
        return (
          <StepExplorer
            data={viewingStep}
            step={currentStep}
            visible={selected}
            simId={simId}
          />
        );
      },
      forceRender: true,
    },
  };

  useEffect(() => {
    if (editorInstance && selectedTab === TabKind.RawOutput) {
      rawOutputTextModel.setValue(serializeRawOutput(viewingStep));

      (rawOutputTextModel as any).forceTokenization(
        rawOutputTextModel.getLineCount(),
      );
    }
  }, [viewingStep, selectedTab, editorInstance, rawOutputTextModel]);

  return (
    <TabActionBar
      actions={[]}
      tabs={visibleTabs.map((tab) => (
        <Tab key={tab.name}>
          {tab.name}
          {embedded ? null : (
            <button
              className="tab-button"
              onClick={(evt) => {
                evt.stopPropagation();
                dispatch(closeTab(tab.kind));
              }}
            >
              <IconClose size={8} />
            </button>
          )}
        </Tab>
      ))}
      tabsRef={tabsRef}
      selectedIndex={selectedTabIndex}
      onSelectedIndexChange={handleTabSelect}
    >
      <div className="simulation-viewer-tab-panel-container">
        {visibleTabs.map((tab) => (
          <TabPanel
            key={tab.kind}
            className={classNames({
              "react-tabs__tab-panel": true,
              RawOutput: tab.kind === TabKind.RawOutput,
            })}
            forceRender={tabs[tab.kind].forceRender ?? false}
          >
            {tabs[tab.kind].el(selectedTab === tab.kind)}
          </TabPanel>
        ))}

        <MonacoContainer
          ref={monacoContainerRef}
          hidden={selectedTab !== TabKind.RawOutput}
        />

        {pyodideStatus === "loading" ||
        (currentExperiment?.target !== "cloud" &&
          pyodide &&
          pyodideStatus !== "unused") ? (
          <SimulationViewerPyodideIndicator pyodideEnabled={pyodide} />
        ) : null}
      </div>
    </TabActionBar>
  );
});
