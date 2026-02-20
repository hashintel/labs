import React, {
  createContext,
  Dispatch,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from "react";
import { v4 as uuid } from "uuid";

import type {
  DependenciesDescriptor,
  FileAction,
  FilesSlice,
  HcBehaviorFile,
  HcDependencyFile,
  HcFile,
  HcSharedBehaviorFile,
} from "./types";
import type { ParsedPath } from "../../util/files/types";
import type { SimulationProject } from "../project/types";
import { HcFileKind } from "./enums";
import { useViewer } from "../viewer/ViewerContext";
import {
  analysisFileId,
  globalsFileId,
  isSharedDependency,
  parseRelativePathsAsTree,
  releaseToHcFiles,
} from "./utils";
import { getSelectors } from "./adapter";
import { parseAnalysis } from "../../components/Analysis/utils";
import { fetchDependencies } from "../../util/api/queries";
import { parseBehaviorKeysQuery } from "../../util/parseBehaviorKeysQuery";
import { sortBy } from "lodash-es";
import {
  filesReducer,
  filesInitialState,
  setCurrentFileId as setCurrentFileIdAction,
  updateFile as updateFileAction,
  deleteFile as deleteFileAction,
  createBehavior as createBehaviorAction,
  renameBehavior as renameBehaviorAction,
  renameInitFile as renameInitFileAction,
  closeFile as closeFileAction,
  closeAllFiles as closeAllFilesAction,
  closeOtherFiles as closeOtherFilesAction,
  closeFilesToTheRight as closeFilesToTheRightAction,
  forkOpenBehavior as forkOpenBehaviorAction,
  setReplaceProposal as setReplaceProposalAction,
  toggleBehaviorKeysEditor as toggleBehaviorKeysEditorAction,
  updateBehaviorKeysFile as updateBehaviorKeysFileAction,
  updateBehaviorKeysDynamicAccess as updateBehaviorKeysDynamicAccessAction,
  toggleVisualGlobals as toggleVisualGlobalsAction,
  toggleVisualAnalysis as toggleVisualAnalysisAction,
  addPreparedFile as addPreparedFileAction,
  createProcessModelFile as createProcessModelFileAction,
  addDependencies,
  parseAndShowBehaviorKeys,
  parseAllBehaviorKeys,
} from "./slice";
import type { BehaviorKeyFields, DraftBehaviorKeys } from "./behaviorKeys";
import { Ext } from "../../util/files/enums";
import type { SimulationSrc } from "../../util/types";

const localSelectors = getSelectors();

export interface FilesContextValue {
  allFiles: HcFile[];
  currentFile: HcFile | undefined;
  currentFileId: string | null;
  fileEntities: Record<string, HcFile | undefined>;
  openFiles: HcFile[];
  openFileIds: string[];
  folderTree: ReturnType<typeof parseRelativePathsAsTree>;
  replaceProposal: FilesSlice["replaceProposal"];
  pendingDependencies: string[];
  fileActions: FileAction[];
  didSave: boolean;
  behaviorKeysVisible: boolean;
  visualGlobals: boolean;
  visualAnalysis: boolean;
  simulationSrc: SimulationSrc | undefined;
  simulationRequiresPyodide: boolean;
  parsedAnalysis: any;
  parsedAnalysisMetricNames: string[];
  globalsSrc: string | undefined;
  analysisSrc: string | undefined;
  experimentsSrc: string | undefined;
  currentBehavior: HcBehaviorFile | HcSharedBehaviorFile | undefined;
  behaviorKeysDynamicAccess: boolean;
  currentFileRepoPath: string | null;
  descriptionSrc: string | undefined;
  parsedDependencies: DependenciesDescriptor;

  setCurrentFileId: (id: string | null) => void;
  updateFile: (id: string, contents: string) => void;
  deleteFile: (id: string) => void;
  createBehavior: (params: {
    contents?: string;
    path: ParsedPath;
    project: SimulationProject;
  }) => void;
  renameBehavior: (id: string, newName: string) => void;
  renameInitFile: (id: string, newName: string) => void;
  closeFile: (id: string) => void;
  closeAllFiles: () => void;
  closeOtherFiles: (id: string) => void;
  closeFilesToTheRight: (id: string) => void;
  forkOpenBehavior: (params: {
    destination: ParsedPath;
    source: HcSharedBehaviorFile;
    project: SimulationProject;
  }) => void;
  setReplaceProposal: (proposal: FilesSlice["replaceProposal"]) => void;
  toggleBehaviorKeysEditor: (fileId: string, defaultKeys?: null | BehaviorKeyFields) => void;
  updateBehaviorKeysFile: (fileId: string, keys: DraftBehaviorKeys) => void;
  updateBehaviorKeysDynamicAccess: (fileId: string, dynamicAccess: boolean) => void;
  toggleVisualGlobals: () => void;
  toggleVisualAnalysis: () => void;
  addPreparedFile: (file: HcFile) => void;
  createProcessModelFile: (params: {
    contents: string;
    repoPath: string;
    project: SimulationProject;
  }) => void;
  handleAddDependencies: (descriptor: DependenciesDescriptor) => Promise<void>;
  handleParseAndShowBehaviorKeys: (fileId: string) => Promise<void>;
  handleParseAllBehaviorKeys: () => Promise<void>;

  filesDispatch: Dispatch<any>;
  filesState: FilesSlice;
}

const FilesContext = createContext<FilesContextValue | null>(null);

export const useFiles = () => {
  const ctx = useContext(FilesContext);
  if (!ctx) throw new Error("useFiles must be inside FilesProvider");
  return ctx;
};

/**
 * Compatibility shim: allows consumers to run selectors against
 * a synthetic state object containing the files slice (and viewer
 * state needed by some cross-cutting selectors). This is a temporary
 * measure until all selectors are replaced with context-derived values.
 */
export const useFilesSelector = <T,>(selector: (state: any) => T): T => {
  const { filesState } = useFiles();
  const viewer = useViewer();
  return selector({
    files: filesState,
    viewer: {
      editor: viewer.editorVisible,
      embedded: viewer.embedded,
      currentTab: viewer.currentTab,
      visibleTabs: viewer.visibleTabs,
      userAlerts: viewer.userAlerts,
      activity: viewer.activityVisible,
      viewer: viewer.viewerVisible,
      currentProcessChart: viewer.currentProcessChart,
      tabOrder: [],
    },
  });
};

export const FilesProvider: FC<PropsWithChildren> = ({ children }) => {
  const { editorVisible } = useViewer();

  const [state, filesDispatch] = useReducer(filesReducer, filesInitialState);

  const allFiles = useMemo(() => localSelectors.selectAll(state), [state]);
  const fileEntities = state.entities as Record<string, HcFile | undefined>;

  const currentFileId = editorVisible
    ? state.currentFileId
    : state.entities.properties
      ? globalsFileId
      : null;

  const currentFile = currentFileId ? fileEntities[currentFileId] : undefined;

  const openFileIds = editorVisible
    ? state.openFileIds
    : state.entities.properties
      ? [globalsFileId]
      : [];

  const openFiles = useMemo(
    () => openFileIds.map((id) => fileEntities[id]).filter(Boolean) as HcFile[],
    [openFileIds, fileEntities],
  );

  const folderTree = useMemo(() => {
    const idKindRepoPathName = allFiles.map((f) => ({
      id: f.id,
      kind: f.kind,
      repoPath: f.repoPath,
      name: f.name,
    }));
    const filtered = idKindRepoPathName.filter(
      (file) => file.kind !== HcFileKind.ProcessModel,
    );
    return sortBy(
      parseRelativePathsAsTree(filtered),
      [(item) => item.children.length === 0, (item) => item.repoPath.toLowerCase()],
      ["asc", "asc"],
    );
  }, [allFiles]);

  const replaceProposal = useMemo(() => {
    const proposal = editorVisible ? state.replaceProposal : null;
    return proposal;
  }, [editorVisible, state.replaceProposal]);

  const currentBehavior = useMemo(
    (): HcBehaviorFile | HcSharedBehaviorFile | undefined =>
      currentFile?.kind === HcFileKind.Behavior ||
      currentFile?.kind === HcFileKind.SharedBehavior
        ? (currentFile as HcBehaviorFile | HcSharedBehaviorFile)
        : undefined,
    [currentFile],
  );

  const behaviorKeysVisible = state.behaviorKeys && !!currentBehavior;
  const behaviorKeysDynamicAccess = currentBehavior?.keys.dynamic_access ?? false;
  const currentFileRepoPath = currentFile?.repoPath ?? null;

  const requiredFiles = useMemo(
    () => allFiles.filter((f) => f.kind === HcFileKind.Required),
    [allFiles],
  );
  const localBehaviorFiles = useMemo(
    () => allFiles.filter((f): f is HcBehaviorFile => f.kind === HcFileKind.Behavior),
    [allFiles],
  );
  const sharedBehaviorFiles = useMemo(
    () =>
      allFiles.filter(
        (f): f is HcSharedBehaviorFile =>
          f.kind === HcFileKind.SharedBehavior ||
          (f.kind === HcFileKind.Behavior && f.repoPath.startsWith("dependencies/")),
      ) as HcSharedBehaviorFile[],
    [allFiles],
  );
  const initFiles = useMemo(
    () => allFiles.filter((f) => f.kind === HcFileKind.Init),
    [allFiles],
  );

  const globalsFile = fileEntities[globalsFileId];
  const globalsSrc = globalsFile?.contents;
  const analysisFile = fileEntities[analysisFileId];
  const analysisSrc = analysisFile?.contents;
  const descriptionFile = fileEntities["description"];
  const descriptionSrc = descriptionFile?.contents;
  const experimentsFile = fileEntities["experiments"];
  const experimentsSrc = experimentsFile?.contents;
  const dependenciesFile = fileEntities["dependencies"];
  const dependenciesSrc = dependenciesFile?.contents;

  const parsedDependencies = useMemo((): DependenciesDescriptor => {
    try {
      return dependenciesSrc ? JSON.parse(dependenciesSrc) : {};
    } catch {
      return {};
    }
  }, [dependenciesSrc]);

  const parsedAnalysis = useMemo(
    () => parseAnalysis(analysisSrc).analysis,
    [analysisSrc],
  );

  const parsedAnalysisMetricNames = useMemo(() => {
    if (
      parsedAnalysis &&
      typeof parsedAnalysis === "object" &&
      "outputs" in parsedAnalysis &&
      parsedAnalysis.outputs &&
      typeof parsedAnalysis.outputs === "object"
    ) {
      return Object.keys(parsedAnalysis.outputs);
    }
    return [];
  }, [parsedAnalysis]);

  const simulationSrc = useMemo((): SimulationSrc | undefined => {
    const ids = [globalsFileId, "analysis", "dependencies", "experiments"];
    const pairs = ids
      .map((id) => [
        id + "Src",
        requiredFiles.find((file) => file.id === id)?.contents,
      ])
      .filter((pair) => pair[1] !== undefined);

    if (pairs.length !== ids.length) return undefined;

    return {
      ...Object.fromEntries(pairs),
      initializers: initFiles.map((file) => ({
        id: file.id,
        name: file.path.formatted,
        initSrc: file.contents,
      })),
      behaviors: localBehaviorFiles.map((file) => ({
        id: file.id,
        name: file.path.formatted,
        dependencies: [],
        behaviorSrc: file.contents,
      })),
    };
  }, [requiredFiles, localBehaviorFiles, initFiles]);

  const simulationRequiresPyodide = useMemo(
    () =>
      sharedBehaviorFiles.some((b) => b.path.ext === Ext.Py) ||
      (simulationSrc?.behaviors?.some((b) => b.name.includes(".py")) ?? false) ||
      (simulationSrc?.initializers?.some((i) => i.name.includes(".py")) ?? false),
    [sharedBehaviorFiles, simulationSrc],
  );

  const fileActions = state.actions;
  const didSave = fileActions.length === 0;

  // --- Action methods ---

  const setCurrentFileId = useCallback(
    (id: string | null) => filesDispatch(setCurrentFileIdAction(id)),
    [filesDispatch],
  );

  const updateFile = useCallback(
    (id: string, contents: string) => filesDispatch(updateFileAction({ id, contents })),
    [filesDispatch],
  );

  const deleteFile = useCallback(
    (id: string) => filesDispatch(deleteFileAction(id)),
    [filesDispatch],
  );

  const createBehavior = useCallback(
    (params: { contents?: string; path: ParsedPath; project: SimulationProject }) =>
      filesDispatch(createBehaviorAction(params)),
    [filesDispatch],
  );

  const renameBehavior = useCallback(
    (id: string, newName: string) => filesDispatch(renameBehaviorAction({ id, newName })),
    [filesDispatch],
  );

  const renameInitFile = useCallback(
    (id: string, newName: string) => filesDispatch(renameInitFileAction({ id, newName })),
    [filesDispatch],
  );

  const closeFile = useCallback(
    (id: string) => filesDispatch(closeFileAction(id)),
    [filesDispatch],
  );

  const closeAllFiles = useCallback(
    () => filesDispatch(closeAllFilesAction("")),
    [filesDispatch],
  );

  const closeOtherFiles = useCallback(
    (id: string) => filesDispatch(closeOtherFilesAction(id)),
    [filesDispatch],
  );

  const closeFilesToTheRight = useCallback(
    (id: string) => filesDispatch(closeFilesToTheRightAction(id)),
    [filesDispatch],
  );

  const forkOpenBehavior = useCallback(
    (params: {
      destination: ParsedPath;
      source: HcSharedBehaviorFile;
      project: SimulationProject;
    }) => filesDispatch(forkOpenBehaviorAction(params)),
    [filesDispatch],
  );

  const setReplaceProposal = useCallback(
    (proposal: FilesSlice["replaceProposal"]) =>
      filesDispatch(setReplaceProposalAction(proposal)),
    [filesDispatch],
  );

  const toggleBehaviorKeysEditor = useCallback(
    (fileId: string, defaultKeys?: null | BehaviorKeyFields) =>
      filesDispatch(toggleBehaviorKeysEditorAction({ fileId, defaultKeys })),
    [filesDispatch],
  );

  const updateBehaviorKeysFile = useCallback(
    (fileId: string, keys: DraftBehaviorKeys) =>
      filesDispatch(updateBehaviorKeysFileAction({ fileId, keys })),
    [filesDispatch],
  );

  const updateBehaviorKeysDynamicAccess = useCallback(
    (fileId: string, dynamicAccess: boolean) =>
      filesDispatch(updateBehaviorKeysDynamicAccessAction({ fileId, dynamicAccess })),
    [filesDispatch],
  );

  const toggleVisualGlobals = useCallback(
    () => filesDispatch(toggleVisualGlobalsAction()),
    [filesDispatch],
  );

  const toggleVisualAnalysis = useCallback(
    () => filesDispatch(toggleVisualAnalysisAction()),
    [filesDispatch],
  );

  const addPreparedFile = useCallback(
    (file: HcFile) => filesDispatch(addPreparedFileAction(file)),
    [filesDispatch],
  );

  const createProcessModelFile = useCallback(
    (params: { contents: string; repoPath: string; project: SimulationProject }) =>
      filesDispatch(createProcessModelFileAction(params)),
    [filesDispatch],
  );

  const handleAddDependencies = useCallback(
    async (descriptor: DependenciesDescriptor) => {
      const requestId = uuid();
      filesDispatch(addDependencies.pending(requestId, descriptor));
      try {
        const releases = await fetchDependencies(descriptor);
        const files = releases.reduce<HcDependencyFile[]>((acc, release) => {
          acc.push(...releaseToHcFiles(release));
          return acc;
        }, []);
        filesDispatch(addDependencies.fulfilled(files, requestId, descriptor));
      } catch (error: any) {
        filesDispatch(addDependencies.rejected(error, requestId, descriptor));
      }
    },
    [filesDispatch],
  );

  const handleParseAndShowBehaviorKeys = useCallback(
    async (fileId: string) => {
      const requestId = uuid();
      const arg = { fileId };
      filesDispatch(parseAndShowBehaviorKeys.pending(requestId, arg));
      try {
        const file = fileEntities[fileId];
        if (!file || file.kind !== HcFileKind.Behavior) {
          throw new Error("Cannot find behavior in state");
        }
        const result = await parseBehaviorKeysQuery(file as HcBehaviorFile);
        filesDispatch(parseAndShowBehaviorKeys.fulfilled(result, requestId, arg));
      } catch (error: any) {
        filesDispatch(parseAndShowBehaviorKeys.rejected(error, requestId, arg));
      }
    },
    [filesDispatch, fileEntities],
  );

  const handleParseAllBehaviorKeys = useCallback(async () => {
    const requestId = uuid();
    filesDispatch(parseAllBehaviorKeys.pending(requestId, undefined));
    try {
      const result: Record<string, BehaviorKeyFields> = {};
      for (const behavior of localBehaviorFiles) {
        try {
          result[behavior.id] = await parseBehaviorKeysQuery(behavior);
        } catch {
          // skip behaviors that fail to parse
        }
      }
      filesDispatch(parseAllBehaviorKeys.fulfilled(result, requestId, undefined));
    } catch (error: any) {
      filesDispatch(parseAllBehaviorKeys.rejected(error, requestId, undefined));
    }
  }, [filesDispatch, localBehaviorFiles]);

  const value = useMemo<FilesContextValue>(
    () => ({
      allFiles,
      currentFile,
      currentFileId,
      fileEntities,
      openFiles,
      openFileIds,
      folderTree,
      replaceProposal,
      pendingDependencies: state.pendingDependencies,
      fileActions,
      didSave,
      behaviorKeysVisible,
      visualGlobals: state.visualGlobals,
      visualAnalysis: state.visualAnalysis,
      simulationSrc,
      simulationRequiresPyodide,
      parsedAnalysis,
      parsedAnalysisMetricNames,
      globalsSrc,
      analysisSrc,
      experimentsSrc,
      currentBehavior,
      behaviorKeysDynamicAccess,
      currentFileRepoPath,
      descriptionSrc,
      parsedDependencies,
      setCurrentFileId,
      updateFile,
      deleteFile,
      createBehavior,
      renameBehavior,
      renameInitFile,
      closeFile,
      closeAllFiles,
      closeOtherFiles,
      closeFilesToTheRight,
      forkOpenBehavior,
      setReplaceProposal,
      toggleBehaviorKeysEditor,
      updateBehaviorKeysFile,
      updateBehaviorKeysDynamicAccess,
      toggleVisualGlobals,
      toggleVisualAnalysis,
      addPreparedFile,
      createProcessModelFile,
      handleAddDependencies,
      handleParseAndShowBehaviorKeys,
      handleParseAllBehaviorKeys,
      filesDispatch,
      filesState: state,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, editorVisible, allFiles, openFiles, folderTree, simulationSrc],
  );

  return <FilesContext.Provider value={value}>{children}</FilesContext.Provider>;
};
