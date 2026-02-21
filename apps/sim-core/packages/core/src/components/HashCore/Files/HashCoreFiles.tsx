import React, { FC, useCallback, useEffect, useRef, useState } from "react";
import { useModal } from "react-modal-hook";

import { ExperimentModal } from "../../Modal/Experiments/ExperimentModal";
import { HashCoreFilesHeaderAction } from "./HashCoreFilesHeaderAction";
import {
  HashCoreFilesListItemFilePending,
  getDomIdByFileId,
} from "./ListItemFile";
import { HashCoreFilesListItemFolder, useNameNewBehaviorModal } from ".";
import { HcFileKind } from "../../../features/files/enums";
import { IconExperimentsCreate, IconFilePlus, IconMagnify } from "../../Icon";
import { ModalNewDataset } from "../../Modal/NewDataset/ModalNewDataset";
import { Scope, useScopes } from "../../../features/scopes";
import { useSearch } from "../../../features/search/SearchContext";
import {
  selectCurrentFileRepoPath,
  selectPendingDependencies,
} from "../../../features/files/selectors";
import {
  useFiles,
  useFilesSelector,
} from "../../../features/files/FilesContext";
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
  const pendingFiles = useFilesSelector(selectPendingDependencies);
  const { canSave, canEdit } = useScopes(
    Scope.save,
    Scope.uploadDataset,
    Scope.edit,
  );
  const currentRepoPath = useFilesSelector(selectCurrentFileRepoPath);
  const { openSearch } = useSearch();

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

  const { folderTree: tree, allFiles } = useFiles();

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
   * Auto-open the data folder when a dataset is uploaded.
   * Tracks file IDs to detect single-file additions (as opposed to bulk
   * project loads which replace all files at once).
   */
  const prevFileIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set(allFiles.map((file) => file.id));
    const prevIds = prevFileIdsRef.current;

    if (prevIds.size > 0) {
      const added = allFiles.filter((file) => !prevIds.has(file.id));

      if (added.length === 1 && added[0].kind === HcFileKind.Dataset) {
        const file = added[0];
        setOpenPaths((openPaths) => ({
          ...openPaths,
          ...calculateOpenFoldersForPath(file.repoPath, openPaths),
        }));

        /**
         * @todo don't rely on querying for ids for this
         */
        setImmediate(() => {
          document
            .querySelector<HTMLLIElement>(`#${getDomIdByFileId(file.id)}`)
            ?.scrollIntoView({ block: "center", inline: "center" });
        });
      }
    }

    prevFileIdsRef.current = currentIds;
  }, [allFiles]);

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
            openSearch();
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

// // @ts-ignore
// HashCoreFiles.whyDidYouRender = {
//   customName: "HashCoreFiles"
// };
