import React, { FC, useState } from "react";

import { HashCoreEditorContainer } from "../EditorContainer/HashCoreEditorContainer";
import { HashCoreViewer } from "../Viewer/HashCoreViewer";
import { WrappedSplitterLayout } from "../../WrappedSplitterLayout/WrappedSplitterLayout";
import { useFiles } from "../../../features/files/FilesContext";
import { useResizeObserver } from "../../../hooks/useResizeObserver/useResizeObserver";
import { useViewer } from "../../../features/viewer/ViewerContext";

import "./HashCoreSection.css";

export const HashCoreSection: FC = () => {
  const { editorVisible, embedded, viewerVisible, userAlerts } = useViewer();
  const { globalsSrc } = useFiles();

  const displayEditorSection = (() => {
    if (editorVisible || userAlerts.length > 0) {
      return true;
    }
    if (!globalsSrc) {
      return false;
    }
    try {
      const parsed = JSON.parse(globalsSrc);
      if (!parsed) {
        return false;
      }
      return Object.keys(parsed).length > 0;
    } catch {
      return true;
    }
  })();

  const [vertical, setVertical] = useState(false);

  const ref = useResizeObserver(({ width }) => setVertical(width <= 700), {
    onObserve: null,
  });

  const components = [
    <HashCoreEditorContainer key="editor" />,
    <HashCoreViewer key="viewer" />,
  ];

  const actuallyVertical = embedded && vertical;

  let primaryIndex: 0 | 1 = 0;

  if (actuallyVertical) {
    components.reverse();
    primaryIndex = 1;
  }

  return (
    <section className="HashCoreSection" ref={ref}>
      <div className="HashCoreSection-splitter">
        <WrappedSplitterLayout
          percentage={true}
          primaryMinSize={20}
          secondaryMinSize={40}
          secondaryInitialSize={editorVisible ? 58 : vertical ? 65 : 75}
          customClassName={actuallyVertical ? "" : "splitter-layout--right"}
          primaryHidden={!displayEditorSection}
          vertical={actuallyVertical}
          primaryIndex={primaryIndex}
          secondaryHidden={!viewerVisible}
        >
          {components}
        </WrappedSplitterLayout>
      </div>
    </section>
  );
};
