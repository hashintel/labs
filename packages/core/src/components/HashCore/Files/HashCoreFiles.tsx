import React, { FC, useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useModal } from "react-modal-hook";
import { PayloadAction } from "@reduxjs/toolkit";
import { filter } from "rxjs/operators";

import { ExperimentModal } from "../../Modal/Experiments/ExperimentModal";
import { HashCoreFilesHeaderAction } from "./HashCoreFilesHeaderAction";
import {
  HashCoreFilesListItemFilePending,
  getDomIdByFileId,
} from "./ListItemFile";
import { HashCoreFilesListItemFolder, useNameNewBehaviorModal } from ".";
import { HcFile } from "../../../features/files/types";
import { HcFileKind } from "../../../features/files/enums";
import { IconExperimentsCreate, IconFilePlus, IconMagnify } from "../../Icon";
import { ModalNewDataset } from "../../Modal/NewDataset/ModalNewDataset";
import { Scope, useScopes } from "../../../features/scopes";
import { addPreparedFile } from "../../../features/files/slice";
import { openSearch } from "../../../features/search";
import {
  selectCurrentFileRepoPath,
  selectFolderTree,
  selectPendingDependencies,
} from "../../../features/files/selectors";
import { storeActionObservable } from "../../../features/actionObservable";
import { useResizeObserver } from "../../../hooks/useResizeObserver/useResizeObserver";

import "./HashCoreFiles.scss";

const calculateOpenFoldersForPath = (
  currentRepoPath: string,
  existingOpenFolders: Record<string, boolean> = {},
) =>
  currentRepoPath
    .split("/")
    .reduce<Record<string, boolean>>((newOpenPaths, _, idx, parts) => {
      const path = parts.slice(0, idx).join("/");

      if (path && !existingOpenFolders[path]) {
        newOpenPaths[path] = true;
      }

      return newOpenPaths;
    }, {});

export const HashCoreFiles: FC = () => {
  const pendingFiles = useSelector(selectPendingDependencies);
  const { canSave, canEdit } = useScopes(
    Scope.save,
    Scope.uploadDataset,
    Scope.edit,
  );
  const currentRepoPath = useSelector(selectCurrentFileRepoPath);
  const dispatch = useDispatch();

  const showNameBehavior = useNameNewBehaviorModal();
  const [_showNewDatasetModal, hideNewDatasetModal] = useModal(
    () => <ModalNewDataset onClose={hideNewDatasetModal} />,
    [],
  );

  // This is set by whichever child component is current
  const scrollIntoViewRef = useRef<VoidFunction | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useResizeObserver(() => {
    scrollIntoViewRef.current?.();
  });
  const setPaneRef = useCallback(
    (node: HTMLDivElement | null) => {
      paneRef.current = node;
      observerRef(node);
    },
    [observerRef],
  );

  const tree = useSelector(selectFolderTree);

  const [openPaths, setOpenPaths] = useState<Record<string, boolean>>(() =>
    currentRepoPath ? calculateOpenFoldersForPath(currentRepoPath) : {},
  );

  /**
   * This could be a ref but then modifying it outside of an effect would break
   * React concurrent mode – instead we use state because we can queue an update
   * to it without breaking CM.
   */
  const [lastRepoPath, setLastRepoPath] =
    useState<typeof currentRepoPath>(currentRepoPath);

  const toggleOpen = useCallback((path: string) => {
    setOpenPaths((openPaths) => ({
      ...openPaths,
      [path]: !openPaths[path],
    }));
  }, []);

  /**
   * This ensures the data folder is open when datasets are uploaded.
   * We purposefully don't open the file because we don't want to download it
   * if it's not necessary to – but we do want to indicate to the user that
   * something changed.
   *
   * @todo move folder state to Redux so can do this in Redux
   */
  useEffect(() => {
    const subscription = storeActionObservable
      .pipe(
        filter((action): action is PayloadAction<HcFile> =>
          addPreparedFile.match(action),
        ),
      )
      .subscribe((action) => {
        const file = action.payload;

        if (file.kind === HcFileKind.Dataset) {
          setOpenPaths((openPaths) => ({
            ...openPaths,
            ...calculateOpenFoldersForPath(file.repoPath, openPaths),
          }));

          /**
           * @todo don't rely on querying for ids for this
           */
          setTimeout(() => {
            document
              .querySelector<HTMLLIElement>(`#${getDomIdByFileId(file.id)}`)
              ?.scrollIntoView({ block: "center", inline: "center" });
          });
        }
      });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const [openCreateExperimentModal, hideCreateExperimentModal] = useModal(
    () => <ExperimentModal onClose={hideCreateExperimentModal} />,
  );

  // Ensure the current file is visible when we change tabs
  if (currentRepoPath && currentRepoPath !== lastRepoPath) {
    const newOpenPaths = calculateOpenFoldersForPath(
      currentRepoPath,
      openPaths,
    );

    if (Object.keys(newOpenPaths).length) {
      setOpenPaths({
        ...openPaths,
        ...newOpenPaths,
      });
    }

    setLastRepoPath(currentRepoPath);
  }

  return (
    <div className="HashCoreFiles" ref={setPaneRef}>
      <ul className="HashCoreFiles__Actions">
        {canSave ? (
          <HashCoreFilesHeaderAction
            paneRef={paneRef}
            title="New Behavior"
            onClick={(evt) => {
              evt.preventDefault();
              showNameBehavior();
            }}
          >
            <IconFilePlus />
          </HashCoreFilesHeaderAction>
        ) : null}
        {/* {canUploadDataset ? (
          <HashCoreFilesHeaderAction
            paneRef={paneRef}
            title="New Dataset"
            onClick={(evt) => {
              evt.preventDefault();
              showNewDatasetModal();
            }}
          >
            <IconTableAdd />
          </HashCoreFilesHeaderAction>
        ) : null} */}
        {canSave ? (
          <HashCoreFilesHeaderAction
            paneRef={paneRef}
            title="New Experiment"
            onClick={(evt) => {
              evt.preventDefault();
              openCreateExperimentModal();
            }}
          >
            <IconExperimentsCreate />
          </HashCoreFilesHeaderAction>
        ) : null}
        <HashCoreFilesHeaderAction
          paneRef={paneRef}
          title={`Search${canEdit ? " & Replace" : ""}`}
          onClick={(evt) => {
            evt.preventDefault();
            dispatch(openSearch());
          }}
        >
          <IconMagnify />
        </HashCoreFilesHeaderAction>
      </ul>

      <ul className="HashCoreFiles__Files">
        <HashCoreFilesListItemFolder
          scrollIntoViewRef={scrollIntoViewRef}
          childrenItems={tree}
          name="root"
          repoPath=""
          isOpen
          rootFolder
          toggleOpen={toggleOpen}
          openPaths={openPaths}
        />
        {pendingFiles.map((id) => (
          <HashCoreFilesListItemFilePending key={id} />
        ))}
      </ul>
    </div>
  );
};

// // @ts-expect-error
// HashCoreFiles.whyDidYouRender = {
//   customName: "HashCoreFiles"
// };
