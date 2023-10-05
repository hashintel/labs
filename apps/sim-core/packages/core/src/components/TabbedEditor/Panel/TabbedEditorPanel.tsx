import { FC, MutableRefObject, useEffect, useRef } from "react";
import { editor } from "monaco-editor";

import type { EditorInstance, TextModel } from "../types";
import { Ext } from "../../../util/files/enums";
import { ViewState } from "../types";
import { parse } from "../../../util/files";
import { restoreEditorState } from "../utils";

export type ViewStates = Record<string, ViewState | null>;
type TabbedEditorPanelProps = {
  editorInstance: EditorInstance | undefined;
  textModel: TextModel | undefined;
  readOnly?: boolean;
  viewStatesRef?: MutableRefObject<ViewStates>;
};

// monaco-editor prepends a `/` to all it's paths
const pathForModel = (textModel: editor.ITextModel) =>
  parse(textModel.uri.path.substring(1));

export const TabbedEditorPanel: FC<TabbedEditorPanelProps> = ({
  editorInstance,
  textModel,
  readOnly = true,
  viewStatesRef,
}) => {
  const readOnlyRef = useRef(readOnly);

  useEffect(() => {
    readOnlyRef.current = readOnly;
  });

  /**
   * readOnly is the only thing about the monaco options / editor state that
   * changes externally without the active file changing, so it has its own
   * effect which is slightly more efficient than triggering unnecessary
   * save/restore view state code & layout code
   */
  useEffect(() => {
    editorInstance?.updateOptions({ readOnly });
  }, [editorInstance, readOnly]);

  useEffect(() => {
    if (!(editorInstance && textModel)) {
      return;
    }

    editorInstance.layout();

    /**
     * `TabbedEditorPanel` "shares" an editor instance with other panels in the
     * same `Tabs` group (see: "../TabbedEditor.tsx") so it's possible when
     * switching tabs for the `editorInstance` to have the `textModel` from the
     * _previous_ `TabbedEditorPanel`
     */
    const currentModel = editorInstance.getModel();
    if (currentModel !== textModel) {
      if (currentModel && viewStatesRef) {
        viewStatesRef.current[
          pathForModel(currentModel).formatted
        ] = editorInstance.saveViewState();
      }

      const path = pathForModel(textModel);
      const { ext } = path;

      restoreEditorState(
        editorInstance,
        textModel,
        viewStatesRef?.current[path.formatted],
        {
          tabSize: 2,
          wordWrap: ext === Ext.Md ? "on" : "off",
          readOnly: readOnlyRef.current,
        }
      );
    }
  }, [editorInstance, textModel, viewStatesRef]);

  return null;
};
