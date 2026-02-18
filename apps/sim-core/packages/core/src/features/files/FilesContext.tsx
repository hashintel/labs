/**
 * Facade over the Redux files slice. Provides the most commonly used file
 * state through context and a passthrough `useFilesSelector` for advanced
 * selectors. Internally still reads from Redux.
 */
import React, {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { useDispatch, useSelector } from "react-redux";

import type { AppDispatch, RootState } from "../types";
import type { HcFile } from "./types";
import {
  selectAllFiles,
  selectCurrentFile,
  selectCurrentFileId,
  selectFileEntities,
  selectFolderTree,
  selectOpenFiles,
  selectOpenFileIds,
} from "./selectors";
import { setCurrentFileId as setCurrentFileIdAction } from "./slice";

export interface FilesContextValue {
  allFiles: HcFile[];
  currentFile: HcFile | undefined;
  currentFileId: string | null;
  fileEntities: Record<string, HcFile | undefined>;
  openFiles: HcFile[];
  openFileIds: string[];
  folderTree: ReturnType<typeof selectFolderTree>;

  setCurrentFileId: (id: string) => void;
  /** Pass-through to useSelector for advanced file selectors. */
  useFilesSelector: <T>(selector: (state: RootState) => T) => T;
  dispatch: AppDispatch;
}

const FilesContext = createContext<FilesContextValue | null>(null);

export const useFiles = () => {
  const ctx = useContext(FilesContext);
  if (!ctx) throw new Error("useFiles must be inside FilesProvider");
  return ctx;
};

/**
 * For selectors not included in the context value, use this hook directly.
 * It's a thin wrapper around useSelector that we can swap out later.
 */
export const useFilesSelector = <T,>(selector: (state: RootState) => T): T =>
  useSelector(selector);

export const FilesProvider: FC<PropsWithChildren> = ({ children }) => {
  const dispatch = useDispatch<AppDispatch>();

  const allFiles = useSelector(selectAllFiles);
  const currentFile = useSelector(selectCurrentFile);
  const currentFileId = useSelector(selectCurrentFileId);
  const fileEntities = useSelector(selectFileEntities);
  const openFiles = useSelector(selectOpenFiles);
  const openFileIds = useSelector(selectOpenFileIds);
  const folderTree = useSelector(selectFolderTree);

  const setCurrentFileId = useCallback(
    (id: string) => dispatch(setCurrentFileIdAction(id)),
    [dispatch],
  );

  const value = useMemo<FilesContextValue>(
    () => ({
      allFiles,
      currentFile,
      currentFileId,
      fileEntities,
      openFiles,
      openFileIds,
      folderTree,
      setCurrentFileId,
      useFilesSelector,
      dispatch,
    }),
    [
      allFiles,
      currentFile,
      currentFileId,
      fileEntities,
      openFiles,
      openFileIds,
      folderTree,
      setCurrentFileId,
      dispatch,
    ],
  );

  return <FilesContext.Provider value={value}>{children}</FilesContext.Provider>;
};
