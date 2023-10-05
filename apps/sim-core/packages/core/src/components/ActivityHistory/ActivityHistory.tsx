import React, { FC, useCallback, useRef, useState } from "react";
import { useSelector } from "react-redux";
import SplitterLayout from "react-splitter-layout";
import classNames from "classnames";

import { ActivityEmpty } from "./ActivityEmpty";
import { ActivityHistoryItemCommitGroup } from "./ActivityHistoryItemCommitGroup";
import { ActivityHistoryRelease } from "./ActivityHistoryRelease";
import { ActivityHistorySingleRun } from "./SingleRun/ActivityHistorySingleRun";
import { AgentInspector } from "./Inspector/Inspector";
import { ExperimentGroup } from "./ExperimentGroup/ExperimentGroup";
import { IconLoading } from "../Icon/Loading";
import { IconSpinner } from "../Icon";
import { Scope, useScope } from "../../features/scopes";
import { ScrollFadeShadow } from "../ScrollFade/ScrollFadeShadow";
import { Select } from "../Inputs/Select/Select";
import { SimulatorHistoryItemType } from "../../features/simulator/simulate/types";
import {
  historySelectors,
  selectHistoryComplete,
} from "../../features/simulator/simulate/selectors";
import { selectProjectRef } from "../../features/project/selectors";
import { theme } from "../../util/theme";
import { useInfiniteScrollingHistory } from "./hooks";
import { useScrollState } from "../../hooks/useScrollState";
import { useSimulatorSelector } from "../../features/simulator/context";

import "./ActivityHistory.scss";

type FilterOption = "Experiments" | "Single Runs" | "Releases" | "Commits";

const filterOptionToItemType: Record<FilterOption, SimulatorHistoryItemType> = {
  "Single Runs": SimulatorHistoryItemType.SingleRun,
  Experiments: SimulatorHistoryItemType.ExperimentRun,
  Releases: SimulatorHistoryItemType.Release,
  Commits: SimulatorHistoryItemType.CommitGroup,
};

export const ActivityHistory: FC<{ visible: boolean }> = ({ visible }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [setScrollStateRef, fadeVisible, scrollable] = useScrollState();
  const historyComplete = useSimulatorSelector(selectHistoryComplete);
  const [
    spinnerRef,
    shouldShowHistory,
    historyInitialized,
  ] = useInfiniteScrollingHistory(containerRef, visible);
  const canEdit = useScope(Scope.edit);
  const projectRef = useSelector(selectProjectRef);

  const historyItemsFromStore = useSimulatorSelector(
    historySelectors.selectAll
  );

  const [selected, setSelected] = useState<"All" | FilterOption>("All");
  const historyItems = (selected === "All"
    ? historyItemsFromStore
    : historyItemsFromStore.filter(
        (item) => item.itemType === filterOptionToItemType[selected]
      )
  ).map((item) => {
    switch (item.itemType) {
      case SimulatorHistoryItemType.ExperimentRun:
        return <ExperimentGroup key={item.historyId} id={item.item.id} />;

      case SimulatorHistoryItemType.SingleRun:
        return (
          <ActivityHistorySingleRun key={item.historyId} id={item.item.id} />
        );

      case SimulatorHistoryItemType.Release:
        return (
          <ActivityHistoryRelease
            tag={item.item.tag}
            createdAt={item.createdAt}
            key={item.historyId}
          />
        );

      case SimulatorHistoryItemType.CommitGroup:
        return (
          <ActivityHistoryItemCommitGroup
            item={item.item}
            createdAt={item.createdAt}
            key={item.historyId}
            historyId={item.historyId}
          />
        );
    }
  });

  const setActivityHistoryRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      setScrollStateRef(node);
    },
    [setScrollStateRef]
  );

  return (
    <div>
      <SplitterLayout
        vertical={true}
        percentage={true}
        primaryMinSize={20}
        secondaryMinSize={30}
        secondaryInitialSize={40}
      >
        <div className="ActivityHistory" ref={setActivityHistoryRef}>
          {/**
           * This second container is needed due to a bug with position sticky in Safari
           * @see https://stackoverflow.com/a/57938266/851985
           */}
          <div
            className={classNames("ActivityHistory__Container", {
              "ActivityHistory__Container--no-content":
                !shouldShowHistory || !historyItems.length,
            })}
          >
            <div className="ActivityHistory__Header">
              <h2>Activity</h2>
              {historyInitialized ? (
                <Select
                  className="ActivityHistory__Header__Select"
                  options={[
                    { value: "All" },
                    { value: "Experiments" },
                    { value: "Single Runs" },
                    { value: "Releases" },
                    { value: "Commits" },
                  ]}
                  value={selected}
                  onChange={(evt) => {
                    setSelected(evt.target.value as any);
                  }}
                />
              ) : (
                <IconLoading end={theme.dark} />
              )}
            </div>
            <div className="ActivityHistory__Header__Border" />
            {shouldShowHistory ? (
              historyItems.length ? (
                <ul
                  className={classNames("ActivityHistory__Items", {
                    "ActivityHistory__Items--scrolls": scrollable,
                  })}
                >
                  {canEdit && projectRef !== "main" ? (
                    <ActivityHistoryRelease tag="main" createdAt={null} />
                  ) : null}
                  {historyItems}
                  {historyComplete ? null : (
                    <li
                      className="ActivityHistory__Items__Loading"
                      ref={spinnerRef}
                    >
                      <IconSpinner size={16} />
                    </li>
                  )}
                </ul>
              ) : (
                <ActivityEmpty>
                  No activity
                  {selected === "All" ? null : (
                    <> matching the specified filters</>
                  )}
                  .
                </ActivityEmpty>
              )
            ) : null}
          </div>
          {historyInitialized && shouldShowHistory && historyItems.length ? (
            <>
              <div className="ActivityHistory__FadeSpacer" />
              <ScrollFadeShadow
                visible={fadeVisible}
                className="ActivityHistory__Fade"
              />
            </>
          ) : null}
        </div>
        <AgentInspector />
      </SplitterLayout>
    </div>
  );
};
