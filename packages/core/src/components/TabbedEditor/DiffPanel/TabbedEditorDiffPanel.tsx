import { FC, useEffect, useMemo, useRef } from "react";
import { useSelector } from "react-redux";
import { Uri, editor } from "monaco-editor";
import { v4 as uuid } from "uuid";

import type { DiffEditorInstance, DiffEditorModel } from "../types";
import type { HcFile } from "../../../features/files/types";
import { getTextModelRequired, languageByExt } from "../../../features/monaco";
import { parse } from "../../../util/files";
import { selectCurrentProjectUrl } from "../../../features/project/selectors";

interface TabbedEditorDiffPanelProps {
  editorInstance: DiffEditorInstance | undefined;
  file: HcFile;
  nextContents: string;
}

export const getDiffModel = (
  manifestId: string | null,
  file: HcFile,
  nextContents: string,
): DiffEditorModel => ({
  original: getTextModelRequired(file, manifestId),
  modified: editor.createModel(
    nextContents,
    languageByExt[file.path.ext],
    Uri.parse(
      parse({
        ...file.path,
        name: `${uuid()}`,
      }).formatted,
    ),
  ),
});

export const TabbedEditorDiffPanel: FC<TabbedEditorDiffPanelProps> = ({
  editorInstance,
  file,
  nextContents,
}) => {
  const viewStateRef = useRef(editorInstance?.saveViewState());
  const projectUrl = useSelector(selectCurrentProjectUrl);

  const diffModel = useMemo(
    () => getDiffModel(projectUrl, file, nextContents),
    [file, projectUrl, nextContents],
  );

  useEffect(() => {
    return () => {
      diffModel.modified.dispose();
    };
  }, [diffModel]);

  useEffect(() => {
    if (!(editorInstance && diffModel)) {
      return;
    }

    editorInstance.layout();

    if (editorInstance.getModel() !== diffModel) {
      editorInstance.setModel(diffModel);

      if (viewStateRef.current) {
        editorInstance.restoreViewState(viewStateRef.current);
      }

      editorInstance.updateOptions({
        /**
         * @todo word wrap for diff views should match that of regular views,
         *      i.e, they should wrap on MD files. However this is not currently
         *      supported. Update this when it is
         * @see https://github.com/microsoft/vscode/issues/11387
         */
        wordWrap: "off",
        readOnly: true,
      });
    }

    return () => {
      viewStateRef.current = editorInstance.saveViewState();
    };
  }, [editorInstance, diffModel]);

  return null;
};
