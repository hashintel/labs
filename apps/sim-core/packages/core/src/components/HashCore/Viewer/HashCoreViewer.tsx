import React, { FC, lazy, Suspense } from "react";
import { useSelector } from "react-redux";

import { ActivityHistory } from "../../ActivityHistory";
import { Scope, useScope } from "../../../features/scopes";
import { SimulationRunner } from "../../SimulationRunner/SimulationRunner";
import { SimulationViewer } from "../../SimulationViewer";
import { WrappedSplitterLayout } from "../../WrappedSplitterLayout/WrappedSplitterLayout";
import { selectActivityVisible } from "../../../features/viewer/selectors";
import { useInstructionReceiver } from "../useInstructionReceiver";
import { useResizeObserver } from "../../../hooks/useResizeObserver/useResizeObserver";

import "./HashCoreViewer.css";

const LazyOpenInCore = lazy(() =>
  import(
    /* webpackChunkName: "OpenInCore" */ "../../OpenInCore/OpenInCore"
  ).then((module) => ({
    default: module.OpenInCore,
  }))
);

export const HashCoreViewer: FC = () => {
  const activityVisible = useSelector(selectActivityVisible);
  const canShowOpenInCore = useScope(Scope.showOpenInCore);

  const onSecondaryPaneSizeChange = (size: number) => {
    document.documentElement.style.setProperty("--activity-width", `${size}px`);
  };

  useInstructionReceiver();

  const viewerRef = useResizeObserver(
    ({ width }) => {
      document.documentElement.style.setProperty(
        "--viewer-width",
        `${Math.round(width)}px`
      );
    },
    { onObserve: null }
  );

  return (
    <div className="HashCoreViewer">
      <WrappedSplitterLayout
        percentage={false}
        primaryMinSize={180}
        secondaryMinSize={200}
        secondaryInitialSize={266}
        secondaryHidden={!activityVisible}
        onSecondaryPaneSizeChange={onSecondaryPaneSizeChange}
      >
        <div className="SimulationViewerMain" ref={viewerRef}>
          <SimulationViewer />
          <SimulationRunner />
          {canShowOpenInCore ? (
            <Suspense fallback={null}>
              <LazyOpenInCore />
            </Suspense>
          ) : null}
        </div>
        <ActivityHistory visible={activityVisible} />
      </WrappedSplitterLayout>
    </div>
  );
};
