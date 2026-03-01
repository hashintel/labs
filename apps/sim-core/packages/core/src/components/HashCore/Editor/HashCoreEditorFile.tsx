import React, {
  Dispatch,
  FC,
  MutableRefObject,
  SetStateAction,
  Suspense,
} from "react";

import {
  useFiles,
  useFilesSelector,
} from "../../../features/files/FilesContext";
import { BehaviorKeys } from "../../BehaviorKeys/BehaviorKeys";
import { DataLoader } from "../../DataLoader/DataLoader";
import { FileBannerWrapper } from "../../FileBanner";
import { GlobalsEditor } from "../../GlobalsEditor";
import { HcFile } from "../../../features/files/types";
import { HcFileKind } from "../../../features/files/enums";
import { Scope, useScopes } from "../../../features/scopes";
import {
  TabbedEditorDiffPanel,
  TabbedEditorPanel,
  useMonacoContainerFromContext,
} from "../../TabbedEditor";
import { ViewStates } from "../../TabbedEditor/Panel/TabbedEditorPanel";
import {
  canAutosuggestKeysForFile,
  globalsFileId,
} from "../../../features/files/utils";
import { getTextModel } from "../../../features/monaco";
import { selectShouldShowBehaviorKeys } from "../../../features/files/selectors";
import { useProject } from "../../../features/project/ProjectContext";

export const HashCoreEditorFile: FC<{
  file: HcFile;
  onDidFallbackChange: Dispatch<SetStateAction<boolean>>;
  tabsHeight?: number;
  viewStatesRef: MutableRefObject<ViewStates>;
  nextContents: string | null;
  onNextContentsChange: (nextContents: string | null) => unknown;
}> = ({
  file,
  onDidFallbackChange,
  tabsHeight,
  viewStatesRef,
  nextContents,
  onNextContentsChange,
}) => {
  const [editorInstance] = useMonacoContainerFromContext();
  const [diffEditorInstance] = useMonacoContainerFromContext(true);

  const { updateBehaviorKeysFile, visualGlobals: shouldShowGlobalEditor } =
    useFiles();
  const { currentProjectUrl: projectUrl } = useProject();
  const shouldShowBehaviorKeys = useFilesSelector(selectShouldShowBehaviorKeys);
  const { canModifyFile, canSaveFile } = useScopes(
    Scope.modifyFile,
    Scope.saveFile,
  );

  return file.kind === HcFileKind.Dataset ? (
    <DataLoader
      url={file.contents}
      editorInstance={editorInstance}
      manifestId={projectUrl}
      file={file}
      setDidFallback={onDidFallbackChange}
      containerHeight={tabsHeight}
    />
  ) : (
    <>
      {shouldShowBehaviorKeys &&
      (file.kind === HcFileKind.Behavior ||
        file.kind === HcFileKind.SharedBehavior) ? (
        <BehaviorKeys
          key={file.id}
          fileId={file.id}
          data={file.keys.keys}
          disabled={!canSaveFile}
          autosuggest={canAutosuggestKeysForFile(file)}
          onChange={(keys) => {
            updateBehaviorKeysFile(file.id, keys);
          }}
        />
      ) : file.id === globalsFileId && shouldShowGlobalEditor ? (
        <Suspense fallback={null}>
          <GlobalsEditor />
        </Suspense>
      ) : null}
      {
        <FileBannerWrapper
          file={file}
          nextContents={nextContents}
          setNextContents={onNextContentsChange}
        />
      }
      {nextContents !== null ? (
        <TabbedEditorDiffPanel
          editorInstance={diffEditorInstance}
          file={file}
          nextContents={nextContents}
        />
      ) : (() => {
        const textModel = getTextModel(file, projectUrl);
        if (!textModel) return null;
        return (
          <TabbedEditorPanel
            editorInstance={editorInstance}
            textModel={textModel}
            readOnly={!canModifyFile}
            viewStatesRef={viewStatesRef}
          />
        );
      })()}
    </>
  );
};
