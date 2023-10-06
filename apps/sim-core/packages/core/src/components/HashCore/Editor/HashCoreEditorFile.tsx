import React, {
  Dispatch,
  FC,
  MutableRefObject,
  SetStateAction,
  Suspense,
} from "react";
import { useDispatch, useSelector } from "react-redux";

import { AppDispatch } from "../../../features/types";
import { BehaviorKeys } from "../../BehaviorKeys/BehaviorKeys";
import { DataLoader } from "../../DataLoader/DataLoader";
import { FileBannerWrapper } from "../../FileBanner";
import { GlobalsEditor } from "../../GlobalsEditor";
import { HcFile } from "../../../features/files/types";
import { HcFileKind } from "../../../features/files/enums";
import {
  Scope,
  selectVisualGlobalsVisible,
  useScopes,
} from "../../../features/scopes";
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
import { getTextModelRequired } from "../../../features/monaco";
import { selectCurrentProjectUrl } from "../../../features/project/selectors";
import { selectShouldShowBehaviorKeys } from "../../../features/files/selectors";
import { updateBehaviorKeysFile } from "../../../features/files/slice";

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

  const dispatch = useDispatch<AppDispatch>();
  const projectUrl = useSelector(selectCurrentProjectUrl);
  const shouldShowBehaviorKeys = useSelector(selectShouldShowBehaviorKeys);
  const shouldShowGlobalEditor = useSelector(selectVisualGlobalsVisible);
  const { canModifyFile, canSaveFile } = useScopes(
    Scope.modifyFile,
    Scope.saveFile
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
            dispatch(
              updateBehaviorKeysFile({
                fileId: file.id,
                keys,
              })
            );
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
      ) : (
        <TabbedEditorPanel
          editorInstance={editorInstance}
          textModel={getTextModelRequired(file, projectUrl)}
          readOnly={!canModifyFile}
          viewStatesRef={viewStatesRef}
        />
      )}
    </>
  );
};
