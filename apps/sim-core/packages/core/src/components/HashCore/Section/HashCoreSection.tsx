import React, { FC, useState } from "react";
import { useSelector } from "react-redux";

import { HashCoreEditorContainer } from "../EditorContainer/HashCoreEditorContainer";
import { HashCoreViewer } from "../Viewer/HashCoreViewer";
import { WrappedSplitterLayout } from "../../WrappedSplitterLayout/WrappedSplitterLayout";
import { selectDisplayEditorSection } from "../../../features/selectors";
import {
  selectEditorVisible,
  selectEmbedded,
  selectViewerVisible,
} from "../../../features/viewer/selectors";
import { useResizeObserver } from "../../../hooks/useResizeObserver/useResizeObserver";

import "./HashCoreSection.css";

export const HashCoreSection: FC = () => {
  const editorVisible = useSelector(selectEditorVisible);
  const displayEditorSection = useSelector(selectDisplayEditorSection);
  const embedded = useSelector(selectEmbedded);
  const [vertical, setVertical] = useState(false);
  const viewerVisible = useSelector(selectViewerVisible);

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
