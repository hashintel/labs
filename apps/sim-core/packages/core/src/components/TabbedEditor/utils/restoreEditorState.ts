import type {
  EditorInstance,
  EditorOptions,
  TextModel,
  ViewState,
} from "../types";
import { setMonacoModel } from "../../../features/monaco/monaco";

export function restoreEditorState(
  editorInstance: EditorInstance,
  textModel: TextModel,
  viewState: ViewState | null | undefined,
  options: EditorOptions,
) {
  if (!textModel.isDisposed()) {
    setMonacoModel(editorInstance, textModel);
  }

  // Toggle the global editor options.
  editorInstance.updateOptions(options);

  if (viewState) {
    editorInstance.restoreViewState(viewState);
    editorInstance.focus();
  }
}
