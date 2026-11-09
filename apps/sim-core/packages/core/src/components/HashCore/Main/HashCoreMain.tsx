import React, { FC } from "react";

import { HashCoreAside, HashCoreSection } from "..";
import { WrappedSplitterLayout } from "../../WrappedSplitterLayout/WrappedSplitterLayout";
import { useAddClassOnClick } from "./util";
import { useViewer } from "../../../features/viewer/ViewerContext";

import "./HashCoreMain.css";

const SIDEBAR_SIZE = 180;

export const HashCoreMain: FC = () => {
  // Necessary to prevent the transition delay delaying the seperator
  // colour changing back on mouseup
  const [setContainerRef] = useAddClassOnClick(
    "layout-splitter",
    "layout-splitter-no-transition-delay",
  );

  // Some floating elements need to be offseted so as not to cover the
  // files panel. This creates a CSS variable to allow them to do that.
  const onSecondaryPaneSizeChange = (size: number) => {
    document.documentElement.style.setProperty(
      "--left-pane-width",
      `${size}px`,
    );
  };

  const { editorVisible } = useViewer();

  return (
    <main className="HashCoreMain" ref={setContainerRef}>
      <WrappedSplitterLayout
        secondaryHidden={!editorVisible}
        primaryIndex={1}
        primaryMinSize={844}
        secondaryMinSize={SIDEBAR_SIZE}
        secondaryInitialSize={SIDEBAR_SIZE}
        onSecondaryPaneSizeChange={onSecondaryPaneSizeChange}
      >
        <HashCoreAside />
        <HashCoreSection />
      </WrappedSplitterLayout>
    </main>
  );
};
