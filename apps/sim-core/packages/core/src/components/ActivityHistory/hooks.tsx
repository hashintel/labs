import React, {
  CSSProperties,
  RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSelector } from "react-redux";
import { useInView } from "react-intersection-observer";
import { useModal } from "react-modal-hook";
import JSZip from "jszip";
import { OutputSeries, PlannedRunVariant } from "@hashintel/engine-web";
import { first } from "rxjs/operators";
import { saveAs } from "file-saver";

import { ActivityHistoryItemTooltip } from "./ActivityHistoryItemTooltip";
import { SimulationRunContextMenu } from "../SimulationRunContextMenu";
import { SimulatorRootState } from "../../features/simulator/types";
import { createSubscriptionToDispatchPlotData } from "../../features/simulator/simulate/analysisMiddleware";
import {
  historySelectors,
  selectAllSimulationData,
  selectCurrentSimulationId,
  selectExperimentRuns,
  selectHistoryComplete,
  selectHistoryHasFilledScreen,
  selectHistoryNextPage,
  selectHistoryReady,
} from "../../features/simulator/simulate/selectors";
import { outputsToCsv } from "./util";
import {
  selectProjectRef,
  selectVersionSwitchingTo,
} from "../../features/project/selectors";
import {
  setHistoryHasFilledScreen,
  setHistoryRequestingMore,
  setHistoryVisible,
  setSelectedSimulation,
} from "../../features/simulator/simulate/slice";
import { useOnClickOutside } from "../../hooks/useOnClickOutside";
import {
  useSimulatorDispatch,
  useSimulatorSelector,
  useSimulatorStore,
} from "../../features/simulator/context";

const preparingForDownloadTooltip = (
  <ActivityHistoryItemTooltip>
    <p>Preparing for download</p>
  </ActivityHistoryItemTooltip>
);

/**
 * Output a single JSON file combining analysis for all runs in an experiment
 * @todo reduce code duplicated in useSimulationRunContextMenu
 */
export const useExperimentRunContextMenu = <T extends HTMLElement>(
  itemRef: RefObject<T>,
  id: string,
  finished = true,
) => {
  const [exporting, setExporting] = useState(false);
  const [contextMenuStyle, setContextMenuStyle] = useState<
    Pick<CSSProperties, "top" | "right">
  >({
    top: 0,
    right: 0,
  });

  const exportingTooltip = exporting ? preparingForDownloadTooltip : null;

  const store = useSimulatorStore();

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const [showContextMenu, hideContextMenu] = useModal(
    () => (
      <SimulationRunContextMenu style={contextMenuStyle}>
        <li>
          <button
            disabled={!finished}
            onClick={async (evt) => {
              evt.preventDefault();

              hideContextMenu();

              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
              }

              timeoutRef.current = setTimeout(() => {
                timeoutRef.current = null;
                setExporting(true);
              }, 200);

              const experiment = selectExperimentRuns(store.getState())[id];

              const simRuns = experiment.simulationIds.map(
                (id) => selectAllSimulationData(store.getState())[id],
              );

              const experimentAnalysisBySimRun: {
                outputs?: OutputSeries | undefined;
                parameters: PlannedRunVariant;
                simRunId: string;
              }[] = await Promise.all(
                simRuns.map(async (simRun) => {
                  const simRunId = simRun.simulationRunId;

                  const existingOutputs =
                    simRun.analysis?.outputs ?? simRun.plots?.outputs;

                  const outputsPromise = existingOutputs
                    ? Promise.resolve(existingOutputs)
                    : createSubscriptionToDispatchPlotData(
                        [simRunId],
                        store.getState,
                      )
                        .pipe(first((results) => results[0] === simRunId))
                        .toPromise()
                        .then((results) => results[1]?.outputs);

                  const outputs = await outputsPromise;

                  const parameters = experiment.plan[simRunId].fields;

                  return {
                    parameters,
                    outputs,
                    simRunId,
                  };
                }),
              );

              const content = new Blob(
                [JSON.stringify(experimentAnalysisBySimRun, null, 2)],
                { type: "application/json" },
              );
              saveAs(content, `experimentrun-${id}.json`);

              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }

              setExporting(false);
            }}
          >
            Export experiment analysis
          </button>
        </li>
      </SimulationRunContextMenu>
    ),
    [contextMenuStyle, id, store, finished],
  );

  useOnClickOutside(itemRef, hideContextMenu);

  const onContextMenu = (evt: React.MouseEvent<T>) => {
    evt.preventDefault();

    setContextMenuStyle({
      top: evt.pageY - 4,
      right: document.body.clientWidth - evt.pageX + 4,
    });

    showContextMenu();
  };

  return [onContextMenu, exportingTooltip, exporting] as const;
};

/**
 * Export analysis and (if downloaded) steps data from a simulation run
 * @todo reduce code duplicated in useExperimentRunContextMenu
 */
export const useSimulationRunContextMenu = <T extends HTMLElement>(
  itemRef: RefObject<T>,
  id: string,
  finished = true,
) => {
  const [exporting, setExporting] = useState(false);
  const [contextMenuStyle, setContextMenuStyle] = useState<
    Pick<CSSProperties, "top" | "right">
  >({
    top: 0,
    right: 0,
  });

  const exportingTooltip = exporting ? preparingForDownloadTooltip : null;

  const store = useSimulatorStore();

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const [showContextMenu, hideContextMenu] = useModal(
    () => (
      <SimulationRunContextMenu style={contextMenuStyle}>
        <li>
          <button
            disabled={!finished}
            onClick={async (evt) => {
              evt.preventDefault();

              hideContextMenu();

              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
              }

              timeoutRef.current = setTimeout(() => {
                timeoutRef.current = null;
                setExporting(true);
              }, 200);

              const simRun = selectAllSimulationData(store.getState())[id];

              const existingOutputs =
                simRun.analysis?.outputs ?? simRun.plots?.outputs;

              const outputsPromise = existingOutputs
                ? Promise.resolve(existingOutputs)
                : createSubscriptionToDispatchPlotData(
                    [simRun.simulationRunId],
                    store.getState,
                  )
                    .pipe(
                      first((results) => results[0] === simRun.simulationRunId),
                    )
                    .toPromise()
                    .then((results) => results[1]?.outputs);

              if (!simRun) {
                console.error("Simulation run doesn't exist for export");
                return;
              }

              const zip = new JSZip();

              for (let idx = 0; idx < simRun.stepsCount; idx++) {
                const step = simRun.steps[idx];
                zip.file(`${idx}.json`, JSON.stringify(step));
              }

              const outputs = await outputsPromise;

              if (outputs && Object.keys(outputs).length > 0) {
                zip.file("metrics.json", JSON.stringify(outputs));
                zip.file("metrics.csv", outputsToCsv(outputs));
              }

              const content = await zip.generateAsync({ type: "blob" });
              saveAs(content, `simulationrun-${id}.zip`);

              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }

              setExporting(false);
            }}
          >
            Export run data
          </button>
        </li>
      </SimulationRunContextMenu>
    ),
    [contextMenuStyle, id, store, finished],
  );

  useOnClickOutside(itemRef, hideContextMenu);

  const onContextMenu = (evt: React.MouseEvent<T>) => {
    evt.preventDefault();

    setContextMenuStyle({
      top: evt.pageY - 4,
      right: document.body.clientWidth - evt.pageX + 4,
    });

    showContextMenu();
  };

  return [onContextMenu, exportingTooltip, exporting] as const;
};

export const useSelectRun = (id: string) => {
  const dispatch = useSimulatorDispatch();

  return () => {
    dispatch(setSelectedSimulation({ simId: id }));
  };
};

const makeSelectSimulationOpen = (id: string) => (state: SimulatorRootState) =>
  selectCurrentSimulationId(state) === id;

export const useRunOpen = (id: string) => {
  const selector = useMemo(() => makeSelectSimulationOpen(id), [id]);

  return useSimulatorSelector(selector);
};

const useWheeling = (
  containerRef: RefObject<HTMLDivElement>,
  deferral = 40,
) => {
  const [wheeling, setWheeling] = useState(false);

  useEffect(() => {
    const node = containerRef.current;

    if (node) {
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const wheel = (evt: WheelEvent) => {
        if (timeout !== null) {
          clearTimeout(timeout);
        }
        if (evt.deltaY <= 0) {
          setWheeling(false);
        } else {
          setWheeling(true);
          timeout = setTimeout(() => {
            timeout = null;
            setWheeling(false);
          }, deferral);
        }
      };
      node.addEventListener("wheel", wheel, { passive: false });

      return () => {
        if (timeout !== null) {
          clearTimeout(timeout);
        }
        node.removeEventListener("wheel", wheel);
      };
    }
  }, [containerRef, deferral]);

  return wheeling;
};

/**
 * Inform Redux if the user has scrolled such that we need to request more
 * history items. We wait until the user has stopped scrolling because inertia
 * scrolling may still be in progress when the new results come in otherwise,
 * which will result in scrolling continuing
 */
const useHistoryRequestMore = (
  containerRef: RefObject<HTMLDivElement>,
  ready: boolean,
) => {
  const [spinnerRef, spinnerInView] = useInView();
  const simDispatch = useSimulatorDispatch();
  const wheeling = useWheeling(containerRef);

  const shouldDispatch = ready && (!spinnerInView || !wheeling);

  useEffect(() => {
    if (shouldDispatch) {
      simDispatch(setHistoryRequestingMore(spinnerInView));
    }
  }, [shouldDispatch, simDispatch, spinnerInView]);

  return spinnerRef;
};

/**
 * This component uses two layout effects to check if the history has filled the
 * screen on every change to it, and communicates that to the Redux store. It
 * does this using layout effects so that we can render the items and check if
 * they fill the screen, but without ever actually painting them to the screen.
 * This prevents them being flashed to the user.
 */
const useCheckIfHistoryFilledScreen = (
  ready: boolean,
  containerRef: React.RefObject<HTMLDivElement>,
) => {
  const simDispatch = useSimulatorDispatch();
  const [checking, setChecking] = useState(false);
  const hasFilledScreen = useSimulatorSelector(selectHistoryHasFilledScreen);

  useLayoutEffect(() => {
    if (checking) {
      const node = containerRef.current;

      if (ready && node) {
        const scrollHeight = node.scrollHeight;
        const offsetHeight = node.offsetHeight;

        simDispatch(setHistoryHasFilledScreen(scrollHeight > offsetHeight));
      }
      setChecking(false);
    }
  }, [ready, checking, containerRef, simDispatch]);

  const historyItemsFromStore = useSimulatorSelector(
    historySelectors.selectAll,
  );
  const itemsRef = useRef<typeof historyItemsFromStore | null>(null);
  const nextPage = useSimulatorSelector(selectHistoryNextPage);
  const nextPageRef = useRef<typeof nextPage | null>(null);

  useLayoutEffect(() => {
    if (
      !hasFilledScreen &&
      (historyItemsFromStore !== itemsRef.current ||
        nextPageRef.current !== nextPage)
    ) {
      nextPageRef.current = nextPage;
      itemsRef.current = historyItemsFromStore;
      setChecking(true);
    }
  }, [hasFilledScreen, historyItemsFromStore, nextPage]);

  return [checking, hasFilledScreen];
};

export const useInfiniteScrollingHistory = (
  containerRef: RefObject<HTMLDivElement>,
  visible: boolean,
) => {
  const ready = useSimulatorSelector(selectHistoryReady);
  const complete = useSimulatorSelector(selectHistoryComplete);
  const spinnerRef = useHistoryRequestMore(containerRef, ready);
  const [checking, hasFilledScreen] = useCheckIfHistoryFilledScreen(
    ready,
    containerRef,
  );

  const simDispatch = useSimulatorDispatch();

  useLayoutEffect(() => {
    if (visible) {
      simDispatch(setHistoryVisible(true));

      return () => {
        simDispatch(setHistoryVisible(false));
      };
    }
  }, [simDispatch, visible]);

  const historyInitialized = hasFilledScreen || complete;
  const showHistory = checking || historyInitialized;

  return [spinnerRef, showHistory, historyInitialized] as const;
};

/**
 * @todo name this better
 */
export const useCurrentRefItem = (
  tag: string | null | undefined,
  ref: RefObject<HTMLElement>,
) => {
  const projectRef = useSelector(selectProjectRef);
  const switchingTo = useSelector(selectVersionSwitchingTo);

  const current = projectRef === tag;
  const currentlySwitchingTo = switchingTo === tag;

  const actuallyCurrent = (current && !switchingTo) || currentlySwitchingTo;

  const wasSwitchingTo = useRef(currentlySwitchingTo);

  useEffect(() => {
    if (actuallyCurrent && !wasSwitchingTo.current) {
      ref.current?.scrollIntoView({
        block: currentlySwitchingTo ? "nearest" : "end",
      });
    }

    wasSwitchingTo.current = currentlySwitchingTo;
  }, [actuallyCurrent, currentlySwitchingTo, ref]);

  return { current, currentlySwitchingTo, actuallyCurrent };
};
