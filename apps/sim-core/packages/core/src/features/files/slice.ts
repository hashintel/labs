import { current, produce } from "immer";
import type { Draft } from "immer";
import findLastIndex from "lodash-es/findLastIndex";
import { v4 } from "uuid";

import {
  BehaviorKeyFields,
  BehaviorKeysDraftField,
  DraftBehaviorKeys,
  DraftBehaviorKeysRoot,
  toRootDraftFormat,
} from "./behaviorKeys";
import { DEFAULT_CURRENT_FILE, DEFAULT_OPEN_FILES } from "../config";
import type {
  DependenciesDescriptor,
  FileAction,
  FilesSlice,
  HcBehaviorFile,
  HcDependencyFile,
  HcFile,
  HcSharedBehaviorFile,
} from "./types";
import { Ext } from "../../util/files/enums";
import { HcFileKind } from "./enums";
import type { ParsedPath } from "../../util/files/types";
import { SimulationProject } from "../project/types";

type RootState = { files: FilesSlice; viewer?: any };

import {
  addMany,
  getInitialState,
  removeMany,
  removeOne,
  updateOne,
  upsertOne,
} from "./adapter";
import {
  behaviorKeysFileName,
  behaviorKeysRepoPath,
  defaultBehaviorKeys,
  isSharedDependency,
  mapFileId,
  repoPathForBehavior,
  stringifyBehaviorKeys,
} from "./utils";
import {
  beginActionSave,
  canUserEditProjectUpdate,
  projectUpdated,
  setProject,
} from "../actions";
import { defaultJsBehaviorSrc } from "../../util/defaultJsBehaviorSrc";
import { isStoringProjectActions } from "../project/utils";
import { parse } from "../../util/files";
import {
  selectAllFilesLocal,
  selectFileByIdLocal,
  selectParsedDependencies,
} from "./selectors";

// ---------------------------------------------------------------------------
// Action type constants
// ---------------------------------------------------------------------------

const PREFIX = "files";

export const ActionTypes = {
  createBehavior: `${PREFIX}/createBehavior`,
  toggleBehaviorKeysEditor: `${PREFIX}/toggleBehaviorKeysEditor`,
  updateBehaviorKeysFile: `${PREFIX}/updateBehaviorKeysFile`,
  updateBehaviorKeysDynamicAccess: `${PREFIX}/updateBehaviorKeysDynamicAccess`,
  updateFile: `${PREFIX}/updateFile`,
  renameBehavior: `${PREFIX}/renameBehavior`,
  renameInitFile: `${PREFIX}/renameInitFile`,
  createProcessModelFile: `${PREFIX}/createProcessModelFile`,
  deleteFile: `${PREFIX}/deleteFile`,
  setCurrentFileId: `${PREFIX}/setCurrentFileId`,
  closeFile: `${PREFIX}/closeFile`,
  closeOtherFiles: `${PREFIX}/closeOtherFiles`,
  closeAllFiles: `${PREFIX}/closeAllFiles`,
  closeFilesToTheRight: `${PREFIX}/closeFilesToTheRight`,
  forkOpenBehavior: `${PREFIX}/forkOpenBehavior`,
  setReplaceProposal: `${PREFIX}/setReplaceProposal`,
  toggleVisualGlobals: `${PREFIX}/toggleVisualGlobals`,
  toggleVisualAnalysis: `${PREFIX}/toggleVisualAnalysis`,
  addPreparedFile: `${PREFIX}/addPreparedFile`,
  addDependenciesPending: `${PREFIX}/addDependencies/pending`,
  addDependenciesFulfilled: `${PREFIX}/addDependencies/fulfilled`,
  addDependenciesRejected: `${PREFIX}/addDependencies/rejected`,
  parseAndShowBehaviorKeysFulfilled: `${PREFIX}/parseAndShowBehaviorKeys/fulfilled`,
  parseAllBehaviorKeysFulfilled: `${PREFIX}/parseAllBehaviorKeys/fulfilled`,
} as const;

// ---------------------------------------------------------------------------
// Action types (for type-safe dispatch)
// ---------------------------------------------------------------------------

interface PayloadAction<T> {
  type: string;
  payload: T;
}

// ---------------------------------------------------------------------------
// Action creators
// ---------------------------------------------------------------------------

export const setCurrentFileId = (
  payload: string | null,
): PayloadAction<string | null> => ({
  type: ActionTypes.setCurrentFileId,
  payload,
});

export const updateFile = (payload: {
  id: string;
  contents: string;
}): PayloadAction<{ id: string; contents: string }> => ({
  type: ActionTypes.updateFile,
  payload,
});

export const deleteFile = (payload: string): PayloadAction<string> => ({
  type: ActionTypes.deleteFile,
  payload,
});

export const createBehavior = (payload: {
  contents?: string;
  path: ParsedPath;
  project: SimulationProject;
}): PayloadAction<typeof payload> => ({
  type: ActionTypes.createBehavior,
  payload,
});

export const renameBehavior = (payload: {
  id: string;
  newName: string;
}): PayloadAction<typeof payload> => ({
  type: ActionTypes.renameBehavior,
  payload,
});

export const renameInitFile = (payload: {
  id: string;
  newName: string;
}): PayloadAction<typeof payload> => ({
  type: ActionTypes.renameInitFile,
  payload,
});

export const closeFile = (payload: string): PayloadAction<string> => ({
  type: ActionTypes.closeFile,
  payload,
});

export const closeAllFiles = (payload: string): PayloadAction<string> => ({
  type: ActionTypes.closeAllFiles,
  payload,
});

export const closeOtherFiles = (payload: string): PayloadAction<string> => ({
  type: ActionTypes.closeOtherFiles,
  payload,
});

export const closeFilesToTheRight = (
  payload: string,
): PayloadAction<string> => ({
  type: ActionTypes.closeFilesToTheRight,
  payload,
});

export const forkOpenBehavior = (payload: {
  destination: ParsedPath;
  source: HcSharedBehaviorFile;
  project: SimulationProject;
}): PayloadAction<typeof payload> => ({
  type: ActionTypes.forkOpenBehavior,
  payload,
});

export const setReplaceProposal = (
  payload: FilesSlice["replaceProposal"],
): PayloadAction<FilesSlice["replaceProposal"]> => ({
  type: ActionTypes.setReplaceProposal,
  payload,
});

export const toggleBehaviorKeysEditor = (payload: {
  fileId: string;
  defaultKeys?: null | BehaviorKeyFields;
}): PayloadAction<typeof payload> => ({
  type: ActionTypes.toggleBehaviorKeysEditor,
  payload,
});

export const updateBehaviorKeysFile = (payload: {
  fileId: string;
  keys: DraftBehaviorKeys;
}): PayloadAction<typeof payload> => ({
  type: ActionTypes.updateBehaviorKeysFile,
  payload,
});

export const updateBehaviorKeysDynamicAccess = (payload: {
  fileId: string;
  dynamicAccess: boolean;
}): PayloadAction<typeof payload> => ({
  type: ActionTypes.updateBehaviorKeysDynamicAccess,
  payload,
});

export const toggleVisualGlobals = (): { type: string } => ({
  type: ActionTypes.toggleVisualGlobals,
});

export const toggleVisualAnalysis = (): { type: string } => ({
  type: ActionTypes.toggleVisualAnalysis,
});

export const addPreparedFile = (payload: HcFile): PayloadAction<HcFile> => ({
  type: ActionTypes.addPreparedFile,
  payload,
});

export const createProcessModelFile = (payload: {
  contents: string;
  repoPath: string;
  project: SimulationProject;
}): PayloadAction<typeof payload> => ({
  type: ActionTypes.createProcessModelFile,
  payload,
});

// Async thunk action creators (matching RTK pattern for compatibility)
function withType<T extends string, F extends (...args: any[]) => any>(
  type: T,
  fn: F,
): F & { type: T } {
  (fn as any).type = type;
  return fn as F & { type: T };
}

export const addDependencies = {
  pending: withType(
    ActionTypes.addDependenciesPending,
    (requestId: string, arg: DependenciesDescriptor) => ({
      type: ActionTypes.addDependenciesPending,
      meta: { arg, requestId },
    }),
  ),
  fulfilled: withType(
    ActionTypes.addDependenciesFulfilled,
    (
      payload: HcDependencyFile[],
      requestId: string,
      arg: DependenciesDescriptor,
    ) => ({
      type: ActionTypes.addDependenciesFulfilled,
      payload,
      meta: { arg, requestId },
    }),
  ),
  rejected: withType(
    ActionTypes.addDependenciesRejected,
    (error: any, requestId: string, arg: DependenciesDescriptor) => ({
      type: ActionTypes.addDependenciesRejected,
      error,
      meta: { arg, requestId },
    }),
  ),
};

export const parseAndShowBehaviorKeys = {
  pending: withType(
    `${PREFIX}/parseAndShowBehaviorKeys/pending` as const,
    (requestId: string, arg: { fileId: string }) => ({
      type: `${PREFIX}/parseAndShowBehaviorKeys/pending` as const,
      meta: { arg, requestId },
    }),
  ),
  fulfilled: withType(
    ActionTypes.parseAndShowBehaviorKeysFulfilled,
    (
      payload: BehaviorKeyFields,
      requestId: string,
      arg: { fileId: string },
    ) => ({
      type: ActionTypes.parseAndShowBehaviorKeysFulfilled,
      payload,
      meta: { arg, requestId },
    }),
  ),
  rejected: withType(
    `${PREFIX}/parseAndShowBehaviorKeys/rejected` as const,
    (error: any, requestId: string, arg: { fileId: string }) => ({
      type: `${PREFIX}/parseAndShowBehaviorKeys/rejected` as const,
      error,
      meta: { arg, requestId },
    }),
  ),
};

type BehaviorKeysRecord = Record<string, BehaviorKeyFields>;

export const parseAllBehaviorKeys = {
  pending: withType(
    `${PREFIX}/parseAllBehaviorKeys/pending` as const,
    (requestId: string, arg: undefined) => ({
      type: `${PREFIX}/parseAllBehaviorKeys/pending` as const,
      meta: { arg, requestId },
    }),
  ),
  fulfilled: withType(
    ActionTypes.parseAllBehaviorKeysFulfilled,
    (payload: BehaviorKeysRecord, requestId: string, arg: undefined) => ({
      type: ActionTypes.parseAllBehaviorKeysFulfilled,
      payload,
      meta: { arg, requestId },
    }),
  ),
  rejected: withType(
    `${PREFIX}/parseAllBehaviorKeys/rejected` as const,
    (error: any, requestId: string, arg: undefined) => ({
      type: `${PREFIX}/parseAllBehaviorKeys/rejected` as const,
      error,
      meta: { arg, requestId },
    }),
  ),
};

// ---------------------------------------------------------------------------
// Internal state helpers (mutate Immer drafts)
// ---------------------------------------------------------------------------

type DistributiveOmit<T, K extends keyof any> = T extends any
  ? Omit<T, K>
  : never;

const setters = {
  removeOpenFileId(state: Draft<FilesSlice>, id: string) {
    const idx = state.openFileIds.indexOf(id);
    if (idx > -1) {
      state.openFileIds.splice(idx, 1);

      if (state.currentFileId === id) {
        setters.setCurrentFileId(state, null);
      }
    }

    if (!state.currentFileId && state.openFileIds.length) {
      setters.setCurrentFileId(
        state,
        state.openFileIds[state.openFileIds.length - 1],
      );
    }
  },
  setCurrentFileId(state: Draft<FilesSlice>, id: string | null = null) {
    state.currentFileId = id;

    if (id) {
      setters.ensureFileOpen(state, id);

      if (state.replaceProposal) {
        state.replaceProposal = null;
      }
    }
  },
  ensureFileOpen(state: Draft<FilesSlice>, id: string) {
    if (state.ids.includes(id)) {
      if (!state.openFileIds.includes(id)) {
        state.openFileIds.push(id);
      }
    } else {
      throw new Error(`Cannot append file that does not exist: ${id}`);
    }
  },
  addFile: (state: Draft<FilesSlice>, file: HcFile) =>
    setters.addFiles(state, [file]),
  addFiles(state: Draft<FilesSlice>, files: HcFile[]) {
    addMany(state, files);

    setters.syncBehaviorKeys(state);
  },

  trackAction(
    state: Draft<FilesSlice>,
    action: DistributiveOmit<FileAction, "uuid" | "saving">,
  ) {
    state.actions.push({
      ...action,
      uuid: v4(),
      saving: false,
    });
  },

  trackFileUpdate(
    state: Draft<FilesSlice>,
    repoPath: string,
    contents: string,
  ) {
    const lastActionIndex = findLastIndex(
      state.actions,
      (action) => action.repoPath === repoPath,
    );

    const existingAction = state.actions[lastActionIndex];
    if (existingAction?.type === "update" && !existingAction.saving) {
      existingAction.contents = contents;
    } else {
      setters.trackAction(state, {
        type: "update",
        repoPath,
        contents,
      });
    }
  },

  updateFileTracked(state: Draft<FilesSlice>, id: string, contents: string) {
    const file = state.entities[id];

    if (!file) {
      throw new Error("Cannot update file that does not exist");
    }

    if (file.contents === contents) {
      return;
    }

    setters.trackFileUpdate(state, file.repoPath, contents);
    updateOne(state, { id, changes: { contents } });
  },

  setDependencies(
    state: Draft<FilesSlice>,
    nextDependencies: DependenciesDescriptor,
  ) {
    const sortedNextDependencies = Object.fromEntries(
      Object.entries(nextDependencies).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    );

    setters.updateFileTracked(
      state,
      "dependencies",
      JSON.stringify(sortedNextDependencies, null, 2),
    );

    state.pendingDependencies = state.pendingDependencies.filter(
      (dep) => !nextDependencies[dep],
    );
  },

  addPendingDependencies(
    state: Draft<FilesSlice>,
    newDependencies: DependenciesDescriptor,
  ) {
    state.pendingDependencies = [
      ...new Set(
        state.pendingDependencies.concat(Object.keys(newDependencies)),
      ),
    ];
  },

  removePendingDependencies(
    state: Draft<FilesSlice>,
    dependencies: DependenciesDescriptor,
  ) {
    state.pendingDependencies = state.pendingDependencies.filter(
      (dep) => !dependencies[dep],
    );
  },

  addDependencies(state: Draft<FilesSlice>, files: HcDependencyFile[]) {
    if (!files.length) {
      return;
    }

    const dependencies = Object.fromEntries(
      files.map((dep) => [dep.path.formatted, dep.ref]),
    );

    const existingDependencies = selectParsedDependencies({
      files: state,
    } as RootState);

    const existingFiles = selectAllFilesLocal(state);
    const fileMap: Record<string, string> = {};

    for (const file of existingFiles) {
      if (dependencies[file.path.formatted]) {
        fileMap[file.id] = files.find(
          (newFile) => newFile.path.formatted === file.path.formatted,
        )!.id;
      }
    }

    state.openFileIds = state.openFileIds.map((id) => fileMap[id] ?? id);
    state.currentFileId =
      (state.currentFileId ? fileMap[state.currentFileId] : null) ??
      state.currentFileId;

    const idsToRemove = existingFiles
      .filter((file) => file && dependencies[file.path.formatted])
      .map((file) => file.id);

    removeMany(state, idsToRemove);

    setters.addFiles(state, files as HcFile[]);
    setters.setDependencies(state, {
      ...existingDependencies,
      ...dependencies,
    });
  },

  removeDependencies(state: Draft<FilesSlice>, ids: string[]) {
    const paths = ids
      .map((id) => selectFileByIdLocal(state, id)?.path.formatted ?? null)
      .filter((path): path is string => path !== null);
    const existingDependencies = selectParsedDependencies({
      files: state,
    } as RootState);

    const newDependencies = Object.fromEntries(
      Object.entries(existingDependencies).filter(
        ([path]) => !paths.includes(path),
      ),
    );

    setters.setDependencies(state, newDependencies);
  },

  deleteFile(state: Draft<FilesSlice>, id: string) {
    const file = state.entities[id];

    if (!file) {
      throw new Error("Cannot delete file that does not exist");
    }

    if ("ref" in file) {
      setters.removeDependencies(state, [id]);
    } else {
      setters.trackAction(state, {
        type: "delete",
        repoPath: file.repoPath,
      });
    }

    if (file.kind === HcFileKind.Behavior && !file.keys._trackCreation) {
      const newFileName = behaviorKeysFileName(file);
      setters.trackAction(state, {
        type: "delete",
        repoPath: repoPathForBehavior(newFileName),
      });
    }

    setters.removeOpenFileId(state, id);

    removeOne(state, id);
  },

  createBehaviorKeysFile(
    state: Draft<FilesSlice>,
    behavior: Draft<HcBehaviorFile>,
  ) {
    setters.trackAction(state, {
      type: "create",
      repoPath: behaviorKeysRepoPath(behavior),
      contents: stringifyBehaviorKeys(behavior),
    });
  },

  createAndOpenBehaviorTracked(
    state: Draft<FilesSlice>,
    project: SimulationProject,
    path: ParsedPath,
    contents: string,
  ) {
    const id = mapFileId(path.base, project.ref);
    const repoPath = `src/behaviors/${path.base}`;

    setters.addFile(state, {
      id,
      path,
      repoPath,
      contents,
      kind: HcFileKind.Behavior,
      keys: {
        ...defaultBehaviorKeys,
        _trackCreation: true,
      },
    });

    setters.trackAction(state, {
      type: "create",
      repoPath,
      contents,
    });

    setters.setCurrentFileId(state, id);
  },
  setReplaceProposal(
    state: Draft<FilesSlice>,
    payload: FilesSlice["replaceProposal"],
  ) {
    if (payload) {
      setters.setCurrentFileId(state, null);
    } else if (state.replaceProposal) {
      setters.setCurrentFileId(state, state.replaceProposal.fileId);
    }

    state.replaceProposal = payload;
  },

  trackBehaviorKeysFileUpdate(
    state: Draft<FilesSlice>,
    fileId: string,
    keys: DraftBehaviorKeysRoot,
  ) {
    const file = state.entities[fileId];

    if (!file) {
      throw new Error("Cannot update keys for behavior that does not exist");
    }

    if (file.kind !== HcFileKind.Behavior) {
      throw new Error("Cannot update keys for non-local behavior");
    }

    const trackCreation = keys._trackCreation;

    file.keys = {
      ...keys,
      _trackCreation: false,
    };

    if (trackCreation) {
      setters.createBehaviorKeysFile(state, file);
    } else {
      setters.trackFileUpdate(
        state,
        behaviorKeysRepoPath(file),
        stringifyBehaviorKeys(file),
      );
    }
  },

  updateBehaviorKeys(
    state: Draft<FilesSlice>,
    fileId: string,
    keys: DraftBehaviorKeys,
  ) {
    const file = state.entities[fileId];

    if (!file) {
      throw new Error("Cannot update keys for behavior that does not exist");
    }

    if (file.kind !== HcFileKind.Behavior) {
      throw new Error("Cannot update keys for non-local behavior");
    }

    const previousKeys = file.keys.keys;

    file.keys.keys = keys;

    setters.trackBehaviorKeysFileUpdate(state, fileId, file.keys);
    setters.syncBehaviorKeys(state, file, previousKeys);
  },

  syncBehaviorKeys(
    state: Draft<FilesSlice>,
    file?: HcBehaviorFile | HcSharedBehaviorFile,
    previousKeys?: DraftBehaviorKeys,
  ) {
    const files = Object.values(current(state.entities));
    const filesToUpdate: Record<string, DraftBehaviorKeysRoot> = {};

    const fileTarget = file?.keys.keys;

    const previousRows = Object.fromEntries(
      (previousKeys ?? fileTarget)?.rows.map(
        (row) => [row[1].uuid, row] as const,
      ) ?? [],
    );

    const localBehaviors = files.filter(
      (sourceFile): sourceFile is HcBehaviorFile =>
        sourceFile?.kind === HcFileKind.Behavior,
    );

    const sharedBehaviors = files.filter(
      (sourceFile): sourceFile is HcSharedBehaviorFile =>
        sourceFile?.kind === HcFileKind.SharedBehavior,
    );

    const behaviorToRows = (behavior: HcBehaviorFile | HcSharedBehaviorFile) =>
      behavior.keys.keys.rows;

    const types: Record<string, BehaviorKeysDraftField> = Object.fromEntries([
      ...[...(fileTarget?.rows ?? [])],
      ...(fileTarget?.rows.filter(([name, value]) => {
        const previousName = previousRows[value.uuid]?.[0];

        return previousName === name;
      }) ?? []),
      ...localBehaviors
        .filter((behavior) => behavior.id !== file?.id)
        .flatMap(behaviorToRows),
      ...(fileTarget?.rows.filter(([, value]) => {
        const previousType = previousRows[value.uuid]?.[1];

        return (
          previousType && JSON.stringify(previousType) !== JSON.stringify(value)
        );
      }) ?? []),
      ...sharedBehaviors.flatMap(behaviorToRows),
    ]);

    for (const sourceFile of localBehaviors) {
      const currentKeys = sourceFile.keys;

      const nextKeys = produce(currentKeys, (keys) => {
        for (let idx = 0; idx < keys.keys.rows.length; idx++) {
          const row = keys.keys.rows[idx];
          const [name, value] = row;

          if (types[name]) {
            keys.keys.rows[idx] = [
              name,
              {
                ...types[name],
                uuid: value.uuid,
              },
            ] as typeof row;
          }
        }
      });

      if (JSON.stringify(nextKeys) !== JSON.stringify(sourceFile.keys)) {
        filesToUpdate[sourceFile.id] = nextKeys;
      }
    }

    for (const [id, keys] of Object.entries(filesToUpdate)) {
      const file = state.entities[id] as HcBehaviorFile;

      file.keys = keys;
      setters.trackBehaviorKeysFileUpdate(state, file.id, file.keys);
    }
  },

  mergeBehaviorKeysWithoutSyncing(
    state: Draft<FilesSlice>,
    file: HcBehaviorFile,
    keys: BehaviorKeyFields,
  ) {
    const existingKeys = file.keys.keys.rows.map((row) => row[0]);
    const newFields = toRootDraftFormat(keys).rows.filter(
      (row) => !existingKeys.includes(row[0]),
    );

    file.keys.keys.rows.push(...newFields);
    setters.trackBehaviorKeysFileUpdate(state, file.id, file.keys);
  },
};

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const filesInitialState = getInitialState<FilesSlice>({
  openFileIds: [],
  currentFileId: null,
  replaceProposal: null,
  pendingDependencies: [],
  actions: [],
  behaviorKeys: false,
  visualGlobals: false,
  visualAnalysis: false,
});

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function rawReducer(state: Draft<FilesSlice>, action: any): FilesSlice | void {
  switch (action.type) {
    // --- Standard file actions ---

    case ActionTypes.createBehavior: {
      const { path, project } = action.payload;
      const fileContents =
        action.payload.contents ??
        (path.ext === Ext.Py
          ? "def behavior(state, context):\n  pass"
          : defaultJsBehaviorSrc);
      setters.createAndOpenBehaviorTracked(state, project, path, fileContents);
      return;
    }

    case ActionTypes.toggleBehaviorKeysEditor: {
      if (state.behaviorKeys) {
        state.behaviorKeys = false;
      } else {
        const draftFile = state.entities[action.payload.fileId];
        if (
          !draftFile ||
          (draftFile.kind !== HcFileKind.Behavior &&
            draftFile.kind !== HcFileKind.SharedBehavior)
        ) {
          throw new Error(
            "Cannot show behavior keys editor for non-existent behavior",
          );
        }
        setters.setCurrentFileId(state, draftFile.id);
        state.behaviorKeys = true;
      }
      return;
    }

    case ActionTypes.updateBehaviorKeysFile: {
      setters.updateBehaviorKeys(
        state,
        action.payload.fileId,
        action.payload.keys,
      );
      return;
    }

    case ActionTypes.updateBehaviorKeysDynamicAccess: {
      const file = state.entities[action.payload.fileId];
      if (file?.kind !== HcFileKind.Behavior) {
        throw new Error("Cannot find behavior in state");
      }
      file.keys.dynamic_access = action.payload.dynamicAccess;
      setters.trackBehaviorKeysFileUpdate(
        state,
        action.payload.fileId,
        file.keys,
      );
      return;
    }

    case ActionTypes.updateFile: {
      setters.updateFileTracked(
        state,
        action.payload.id.toString(),
        action.payload.contents,
      );
      return;
    }

    case ActionTypes.renameBehavior: {
      const { newName, id } = action.payload;
      const file = state.entities[id];
      if (!file) {
        throw new Error("Cannot rename file which does not exist");
      }
      if (newName === file.path.base) return;

      const repoPath = `src/behaviors/${newName}`;
      setters.trackAction(state, {
        type: "move",
        oldRepoPath: file.repoPath,
        repoPath,
      });
      if (file.kind === HcFileKind.Behavior && !file.keys._trackCreation) {
        setters.trackAction(state, {
          type: "move",
          oldRepoPath: `${file.repoPath}.json`,
          repoPath: `${repoPath}.json`,
        });
      }
      const path = parse(newName);
      const newId = mapFileId(path.base, "main");
      updateOne(state, { id, changes: { path, repoPath } });
      const updatedFile = current(state).entities[id]!;
      upsertOne(state, { ...updatedFile, id: newId });
      removeOne(state, id);
      state.openFileIds = state.openFileIds.map((openId) =>
        openId === id ? newId : openId,
      );
      state.currentFileId =
        state.currentFileId === id ? newId : state.currentFileId;
      return;
    }

    case ActionTypes.renameInitFile: {
      const { newName, id } = action.payload;
      const file = state.entities[id];
      if (!file) {
        throw new Error("Cannot rename file which does not exist");
      }
      if (newName === file.path.base) return;

      const repoPath = `src/${newName}`;
      setters.trackAction(state, {
        type: "move",
        oldRepoPath: file.repoPath,
        repoPath,
      });
      const path = parse(newName);
      const newId = mapFileId(path.base, "main");
      updateOne(state, { id, changes: { path, repoPath } });
      const updatedFile = current(state).entities[id]!;
      upsertOne(state, { ...updatedFile, id: newId });
      removeOne(state, id);
      state.openFileIds = state.openFileIds.map((openId) =>
        openId === id ? newId : openId,
      );
      state.currentFileId =
        state.currentFileId === id ? newId : state.currentFileId;
      return;
    }

    case ActionTypes.createProcessModelFile: {
      const { contents, project, repoPath } = action.payload;
      const parsedPath = parse(repoPath);
      const id = mapFileId(parsedPath.base, project.ref);
      setters.addFile(state, {
        id,
        path: parsedPath,
        repoPath,
        contents,
        kind: HcFileKind.ProcessModel,
      });
      setters.trackAction(state, {
        type: "create",
        repoPath,
        contents,
      });
      return;
    }

    case ActionTypes.deleteFile: {
      setters.deleteFile(state, action.payload);
      return;
    }

    case ActionTypes.setCurrentFileId: {
      setters.setCurrentFileId(state, action.payload);
      return;
    }

    case ActionTypes.closeFile: {
      const id = action.payload;
      if (state.openFileIds.includes(id)) {
        setters.removeOpenFileId(state, id);
        if (state.currentFileId === id && state.openFileIds.length > 0) {
          setters.setCurrentFileId(
            state,
            state.openFileIds[state.openFileIds.length - 1],
          );
        }
      }
      return;
    }

    case ActionTypes.closeOtherFiles: {
      const id = action.payload;
      setters.setCurrentFileId(state, id);
      if (!state.openFileIds.includes(id)) {
        console.error("Error: the current file is not available, aborting.");
        return;
      }
      const openFileIds = [...state.openFileIds];
      openFileIds.forEach((openFileId) => {
        if (openFileId !== id) {
          setters.removeOpenFileId(state, openFileId);
        }
      });
      return;
    }

    case ActionTypes.closeAllFiles: {
      if (!state.openFileIds.length) {
        throw new Error("There are no open files, so we can't close them.");
      }
      const openFileIds = [...state.openFileIds];
      openFileIds.forEach((openFileId) => {
        setters.removeOpenFileId(state, openFileId);
      });
      return;
    }

    case ActionTypes.closeFilesToTheRight: {
      const id = action.payload;
      setters.setCurrentFileId(state, id);
      if (!state.openFileIds.includes(id)) {
        console.error("Error: the current file is not available, aborting.");
        return;
      }
      const openFileIds = [
        ...state.openFileIds.slice(state.openFileIds.indexOf(id) + 1),
      ];
      openFileIds.forEach((openFileId) => {
        setters.removeOpenFileId(state, openFileId);
      });
      return;
    }

    case ActionTypes.forkOpenBehavior: {
      const { destination, source, project } = action.payload;
      setters.createAndOpenBehaviorTracked(
        state,
        project,
        destination,
        source.contents,
      );
      setters.deleteFile(state, source.id);
      const id = mapFileId(destination.base, project.ref);
      const behavior = state.entities[id]!;
      if (behavior.kind !== HcFileKind.Behavior) {
        throw new Error(
          "Cannot create behavior keys file for non-existent behavior",
        );
      }
      behavior.keys = source.keys;
      setters.createBehaviorKeysFile(state, behavior);
      return;
    }

    case ActionTypes.setReplaceProposal: {
      setters.setReplaceProposal(state, action.payload);
      return;
    }

    case ActionTypes.toggleVisualGlobals: {
      state.visualGlobals = !state.visualGlobals;
      return;
    }

    case ActionTypes.toggleVisualAnalysis: {
      state.visualAnalysis = !state.visualAnalysis;
      return;
    }

    case ActionTypes.addPreparedFile: {
      setters.addFile(state, action.payload);
      return;
    }

    // --- Async dependency actions ---

    case ActionTypes.addDependenciesPending: {
      setters.addPendingDependencies(state, action.meta.arg);
      return;
    }

    case ActionTypes.addDependenciesRejected: {
      setters.removePendingDependencies(state, action.meta.arg);
      return;
    }

    case ActionTypes.addDependenciesFulfilled: {
      setters.addDependencies(state, action.payload);
      return;
    }

    // --- Shared actions (cross-context) ---

    case setProject.type: {
      const prevState = current(state);
      return produce(filesInitialState, (newState) => {
        const { meta: { replaceTabs = true, file = undefined } = {}, project } =
          action.payload;

        setters.addFiles(newState, project.files);

        if (isStoringProjectActions(project)) {
          newState.actions = project.actions;
        }

        const openFiles = replaceTabs
          ? DEFAULT_OPEN_FILES
          : prevState.openFileIds;
        for (const id of openFiles) {
          setters.ensureFileOpen(newState, id);
        }

        if (file && newState.entities[file]) {
          setters.setCurrentFileId(newState, file);
        } else {
          setters.setCurrentFileId(
            newState,
            replaceTabs ? DEFAULT_CURRENT_FILE : prevState.currentFileId,
          );
        }
      });
    }

    case projectUpdated.type: {
      const { actions } = action.payload;
      if (actions) {
        const uuids = actions.map((a: any) => a.uuid);
        state.actions = state.actions.filter((a) => !uuids.includes(a.uuid));
      }
      return;
    }

    case canUserEditProjectUpdate.type: {
      const deps: any[] = action.payload.dependencies;
      const map: Record<string, boolean> = {};
      for (const dep of deps) {
        map[dep.pathWithNamespace] = dep.canUserEdit;
      }
      for (const id of state.ids) {
        const file = state.entities[id];
        if (
          file &&
          isSharedDependency(file) &&
          map[file.pathWithNamespace] !== undefined
        ) {
          file.canUserEdit = map[file.pathWithNamespace];
        }
      }
      return;
    }

    case ActionTypes.parseAndShowBehaviorKeysFulfilled: {
      const fileId = action.meta.arg.fileId;
      const file = state.entities[fileId];
      if (file?.kind !== HcFileKind.Behavior) {
        throw new Error("Cannot find behavior");
      }
      setters.mergeBehaviorKeysWithoutSyncing(state, file, action.payload);
      setters.syncBehaviorKeys(state);
      state.behaviorKeys = true;
      setters.setCurrentFileId(state, action.meta.arg.fileId);
      return;
    }

    case ActionTypes.parseAllBehaviorKeysFulfilled: {
      for (const [fileId, keys] of Object.entries(action.payload)) {
        const file = state.entities[fileId];
        if (file?.kind !== HcFileKind.Behavior) {
          throw new Error("Cannot find behavior");
        }
        setters.mergeBehaviorKeysWithoutSyncing(
          state,
          file,
          keys as BehaviorKeyFields,
        );
      }
      setters.syncBehaviorKeys(state);
      return;
    }

    case beginActionSave.type: {
      for (const a of state.actions) {
        if (action.payload.includes(a.uuid)) {
          a.saving = true;
        }
      }
      return;
    }

    default:
      return;
  }
}

export const filesReducer = (
  state: FilesSlice = filesInitialState,
  action: any,
): FilesSlice => {
  return produce(state, (draft) => {
    return rawReducer(draft, action);
  });
};
