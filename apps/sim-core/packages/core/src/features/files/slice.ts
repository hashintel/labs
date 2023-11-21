import {
  createNextState,
  createSlice,
  current,
  Draft,
  EntityId,
  PayloadAction,
} from "@reduxjs/toolkit";
import findLastIndex from "lodash/findLastIndex";
import produce from "immer";
import { filter, mergeMap, reduce } from "rxjs/operators";
import { from } from "rxjs";
import { v4 } from "uuid";

import { AsyncAppThunk } from "../types";
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
import type { RootState } from "../types";
import { SimulationProject } from "../project/types";
import { addDatasetToProject } from "../../util/api/queries/addDatasetToProject";
import {
  addMany,
  getInitialState,
  removeMany,
  removeOne,
  updateOne,
  upsertOne,
} from "./adapter";
import {
  allocateDatasetFileName,
  behaviorKeysFileName,
  behaviorKeysRepoPath,
  canAutosuggestKeysForFile,
  defaultBehaviorKeys,
  isSharedDependency,
  mapFileId,
  releaseToHcFiles,
  repoPathForBehavior,
  stringifyBehaviorKeys,
  toHcFiles,
} from "./utils";
import {
  beginActionSave,
  canUserEditProjectUpdate,
  projectUpdated,
  setProject,
} from "../actions";
import { createAppAsyncThunk } from "../createAppAsyncThunk";
import { createDatasetQuery } from "../../util/api/queries/createDatasetQuery";
import { defaultJsBehaviorSrc } from "../../util/defaultJsBehaviorSrc";
import { fetchDependencies } from "../../util/api/queries";
import { forkAndReleaseBehaviors, save } from "../thunks";
import { isStoringProjectActions } from "../project/utils";
import { parse } from "../../util/files";
import { parseBehaviorKeysQuery } from "../../util/parseBehaviorKeysQuery";
import { postFormData } from "../../util/postFormData";
import { prepareFormDataWithFile } from "../../util/prepareFormDataWithFile";
import {
  selectAllFilesLocal,
  selectDatasetFiles,
  selectFileByIdLocal,
  selectFileEntities,
  selectLocalBehaviorFiles,
  selectParsedDependencies,
} from "./selectors";
import { selectCurrentProjectRequired } from "../project/selectors";
import { toggleEditor } from "../viewer/slice";
import { trackEvent } from "../analytics";

export const addDependencies = createAppAsyncThunk<
  HcDependencyFile[],
  DependenciesDescriptor
>("files/addDependencies", async (descriptor, { signal }) => {
  const releases = await fetchDependencies(descriptor, signal);

  return releases.reduce<HcDependencyFile[]>((files, release) => {
    files.push(...releaseToHcFiles(release));

    return files;
  }, []);
});

export const parseAndShowBehaviorKeys = createAppAsyncThunk<
  BehaviorKeyFields,
  { fileId: string }
>(
  "files/parseAndShowBehaviorKeys",
  async ({ fileId }, { signal, getState }) => {
    const file = selectFileEntities(getState())[fileId];

    if (file?.kind !== HcFileKind.Behavior) {
      throw new Error("Cannot find behavior in state");
    }

    if (!canAutosuggestKeysForFile(file)) {
      throw new Error("Cannot parse keys for this behavior");
    }

    return await parseBehaviorKeysQuery(file, signal);
  }
);

type BehaviorKeysRecord = Record<string, BehaviorKeyFields>;

export const parseAllBehaviorKeys = createAppAsyncThunk<BehaviorKeysRecord>(
  "files/parseAllBehaviorKeys",
  async (_, { signal, getState }) => {
    const behaviors = selectLocalBehaviorFiles(getState());

    return from(behaviors)
      .pipe(
        filter((behavior) => canAutosuggestKeysForFile(behavior)),
        mergeMap(async (behavior): Promise<BehaviorKeysRecord> => {
          return {
            [behavior.id]: await parseBehaviorKeysQuery(behavior, signal),
          };
        }, 4),
        reduce(
          (record, piece): BehaviorKeysRecord => ({ ...record, ...piece }),
          {}
        )
      )
      .toPromise()
      .catch((err) => {
        if (err.name !== "AbortError") {
          throw err;
        }

        return {};
      });
  }
);

export const createDataset = (
  file: File,
  reportProgress?: (progress: number) => void
): AsyncAppThunk => async (dispatch, getState) => {
  /**
   * We're saving before we mutate the project because we may be creating a
   * dataset replacing one we've deleted, which we need to ensure has
   * already been deleted on the API
   *
   * We're not awaiting it yet because we don't need it to be finished until
   * later on when we add the dataset to the project
   */
  const savePromise = dispatch(save());

  const state = getState();
  const project = selectCurrentProjectRequired(state);
  const datasets = selectDatasetFiles(state);
  const filename = allocateDatasetFileName(file.name, datasets);

  const { dataset, postForm } = await createDatasetQuery(
    project.pathWithNamespace,
    filename,
    file.name
  );

  await postFormData(
    postForm.url,
    prepareFormDataWithFile(file, postForm.fields),
    reportProgress
  );

  // Ensure this has finished
  await savePromise;

  const thisDataset = await addDatasetToProject(
    project.pathWithNamespace,
    dataset.id,
    postForm.fields?.key,
    file.name.endsWith(".csv")
  );

  await dispatch(
    trackEvent({
      action: "New dataset: Core",
      label: `${dataset?.name} - ${dataset?.id}`,
    })
  );

  if (!thisDataset) {
    throw new Error("Cannot find dataset in results");
  }

  const datasetFile = toHcFiles({
    files: [
      {
        ...thisDataset.file,
        ref: project.ref,
      },
    ],
  })[0];

  dispatch(addPreparedFile(datasetFile));
};

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
        state.openFileIds[state.openFileIds.length - 1]
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
      const currentState = current(state);
      console.log("===== CURRENT STATE =====");
      for (const [key, value] of Object.entries(currentState)) {
        switch (key) {
          case "actions":
            console.log("===== ACTIONS =====");

            for (const action of currentState.actions) {
              console.log(JSON.stringify(action));
            }

            console.log("===== END ACTIONS =====");
            break;
          case "entities":
            for (const entity of Object.values(currentState.entities)) {
              console.log(JSON.stringify(entity));
            }
            break;
          default:
            console.log(key, JSON.stringify(value));
            break;
        }
      }
      console.log("===== LOCAL STORAGE =====");

      try {
        for (const [key, value] of Object.entries(localStorage)) {
          console.log(key, value);
        }
      } catch (err) {
        console.warn("Could not log localStorage", err);
      }

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
    action: DistributiveOmit<FileAction, "uuid" | "saving">
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
    contents: string
  ) {
    const lastActionIndex = findLastIndex(
      state.actions,
      (action) => action.repoPath === repoPath
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

  updateFileTracked(state: Draft<FilesSlice>, id: EntityId, contents: string) {
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
    nextDependencies: DependenciesDescriptor
  ) {
    const sortedNextDependencies = Object.fromEntries(
      Object.entries(nextDependencies).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0
      )
    );

    setters.updateFileTracked(
      state,
      "dependencies",
      JSON.stringify(sortedNextDependencies, null, 2)
    );

    state.pendingDependencies = state.pendingDependencies.filter(
      (dep) => !nextDependencies[dep]
    );
  },

  addPendingDependencies(
    state: Draft<FilesSlice>,
    newDependencies: DependenciesDescriptor
  ) {
    state.pendingDependencies = [
      ...new Set(
        state.pendingDependencies.concat(Object.keys(newDependencies))
      ),
    ];
  },

  removePendingDependencies(
    state: Draft<FilesSlice>,
    dependencies: DependenciesDescriptor
  ) {
    state.pendingDependencies = state.pendingDependencies.filter(
      (dep) => !dependencies[dep]
    );
  },

  addDependencies(state: Draft<FilesSlice>, files: HcDependencyFile[]) {
    if (!files.length) {
      return;
    }

    const dependencies = Object.fromEntries(
      files.map((dep) => [dep.path.formatted, dep.ref])
    );

    const existingDependencies = selectParsedDependencies({
      files: state,
    } as RootState);

    const existingFiles = selectAllFilesLocal(state);
    const fileMap: Record<string, string> = {};

    for (const file of existingFiles) {
      if (dependencies[file.path.formatted]) {
        fileMap[file.id] = files.find(
          (newFile) => newFile.path.formatted === file.path.formatted
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
        ([path]) => !paths.includes(path)
      )
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
    behavior: Draft<HcBehaviorFile>
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
    contents: string
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
    payload: FilesSlice["replaceProposal"]
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
    keys: DraftBehaviorKeysRoot
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
        stringifyBehaviorKeys(file)
      );
    }
  },

  updateBehaviorKeys(
    state: Draft<FilesSlice>,
    fileId: string,
    keys: DraftBehaviorKeys
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
    previousKeys?: DraftBehaviorKeys
  ) {
    const files = Object.values(current(state.entities));
    const filesToUpdate: Record<string, DraftBehaviorKeysRoot> = {};

    const fileTarget = file?.keys.keys;

    const previousRows = Object.fromEntries(
      (previousKeys ?? fileTarget)?.rows.map(
        (row) => [row[1].uuid, row] as const
      ) ?? []
    );

    const localBehaviors = files.filter(
      (sourceFile): sourceFile is HcBehaviorFile =>
        sourceFile?.kind === HcFileKind.Behavior
    );

    const sharedBehaviors = files.filter(
      (sourceFile): sourceFile is HcSharedBehaviorFile =>
        sourceFile?.kind === HcFileKind.SharedBehavior
    );

    const behaviorToRows = (behavior: HcBehaviorFile | HcSharedBehaviorFile) =>
      behavior.keys.keys.rows;

    // Later entries have the priority where there are clashes
    const types: Record<string, BehaviorKeysDraftField> = Object.fromEntries([
      ...[...(fileTarget?.rows ?? [])],
      /**
       * Ensure any row whose name did not change is prioritised over a row
       * whose name was just changed. This ensures renaming a row overwrites the
       * current type, not other types.
       */
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
    keys: BehaviorKeyFields
  ) {
    const existingKeys = file.keys.keys.rows.map((row) => row[0]);
    const newFields = toRootDraftFormat(keys).rows.filter(
      (row) => !existingKeys.includes(row[0])
    );

    file.keys.keys.rows.push(...newFields);
    setters.trackBehaviorKeysFileUpdate(state, file.id, file.keys);
  },
};

const filesInitialState = getInitialState<FilesSlice>({
  ids: [],
  entities: {},
  openFileIds: [],
  currentFileId: null,
  replaceProposal: null,
  pendingDependencies: [],
  actions: [],
  behaviorKeys: false,
  visualGlobals: false,
  visualAnalysis: false,
});

export const {
  actions: {
    createProcessModelFile,
    deleteFile,
    forkOpenBehavior,
    setCurrentFileId,
    updateFile,
    setReplaceProposal,
    createBehavior,
    renameBehavior,
    renameInitFile,
    closeFile,
    closeAllFiles,
    closeFilesToTheRight,
    closeOtherFiles,
    updateBehaviorKeysFile,
    updateBehaviorKeysDynamicAccess,
    toggleBehaviorKeysEditor,
    toggleVisualGlobals,
    toggleVisualAnalysis,
    addPreparedFile,
  },
  reducer: filesReducer,
} = createSlice({
  name: "files",
  initialState: filesInitialState,
  reducers: {
    createBehavior(
      state,
      action: PayloadAction<{
        contents?: string;
        path: ParsedPath;
        project: SimulationProject;
      }>
    ) {
      const { path, project } = action.payload;

      const fileContents =
        action.payload.contents ??
        (path.ext === Ext.Py
          ? "def behavior(state, context):\n  pass"
          : defaultJsBehaviorSrc);

      setters.createAndOpenBehaviorTracked(state, project, path, fileContents);
    },

    toggleBehaviorKeysEditor(
      state,
      action: PayloadAction<{
        fileId: string;
        defaultKeys?: null | BehaviorKeyFields;
      }>
    ) {
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
            "Cannot show behavior keys editor for non-existent behavior"
          );
        }

        setters.setCurrentFileId(state, draftFile.id);
        state.behaviorKeys = true;
      }
    },

    updateBehaviorKeysFile(
      state,
      action: PayloadAction<{
        fileId: string;
        keys: DraftBehaviorKeys;
      }>
    ) {
      setters.updateBehaviorKeys(
        state,
        action.payload.fileId,
        action.payload.keys
      );
    },

    updateBehaviorKeysDynamicAccess(
      state,
      action: PayloadAction<{
        fileId: string;
        dynamicAccess: boolean;
      }>
    ) {
      const file = state.entities[action.payload.fileId];

      if (file?.kind !== HcFileKind.Behavior) {
        throw new Error("Cannot find behavior in state");
      }

      file.keys.dynamic_access = action.payload.dynamicAccess;

      setters.trackBehaviorKeysFileUpdate(
        state,
        action.payload.fileId,
        file.keys
      );
    },

    updateFile(
      state,
      action: PayloadAction<{ id: EntityId; contents: string }>
    ) {
      setters.updateFileTracked(
        state,
        action.payload.id.toString(),
        action.payload.contents
      );
    },

    renameBehavior(
      state,
      action: PayloadAction<{ id: EntityId; newName: string }>
    ) {
      const { newName, id } = action.payload;

      const file = state.entities[id];

      if (!file) {
        throw new Error("Cannot rename file which does not exist");
      }

      if (newName === file.path.base) {
        // GitLab errors on a request to move a file to its existing location
        return;
      }

      /**
       * This will break if we ever support proper folder structure
       *
       * @todo fix this
       */
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
      /**
       * We're assuming ref here is main because we're allowing changes. This
       * is probably a fair assumption, but could cause problems if it does not
       * hold true.
       */
      const newId = mapFileId(path.base, "main");

      updateOne(state, { id, changes: { path, repoPath } });

      const updatedFile = current(state).entities[id]!;

      upsertOne(state, { ...updatedFile, id: newId });
      removeOne(state, id);

      state.openFileIds = state.openFileIds.map((openId) =>
        openId === id ? newId : openId
      );
      state.currentFileId =
        state.currentFileId === id ? newId : state.currentFileId;
    },

    // This is a close copy-paste of renameBehavior. We can refactor when we support
    // arbitrary init file names & folder structure.
    renameInitFile(
      state,
      action: PayloadAction<{ id: EntityId; newName: string }>
    ) {
      const { newName, id } = action.payload;

      const file = state.entities[id];

      if (!file) {
        throw new Error("Cannot rename file which does not exist");
      }

      if (newName === file.path.base) {
        // GitLab errors on a request to move a file to its existing location
        return;
      }

      /**
       * This will break if we ever support proper folder structure
       *
       * @todo fix this
       */
      const repoPath = `src/${newName}`;

      setters.trackAction(state, {
        type: "move",
        oldRepoPath: file.repoPath,
        repoPath,
      });

      const path = parse(newName);
      /**
       * We're assuming ref here is main because we're allowing changes. This
       * is probably a fair assumption, but could cause problems if it does not
       * hold true.
       */
      const newId = mapFileId(path.base, "main");

      updateOne(state, { id, changes: { path, repoPath } });

      const updatedFile = current(state).entities[id]!;

      upsertOne(state, { ...updatedFile, id: newId });
      removeOne(state, id);

      state.openFileIds = state.openFileIds.map((openId) =>
        openId === id ? newId : openId
      );
      state.currentFileId =
        state.currentFileId === id ? newId : state.currentFileId;
    },

    createProcessModelFile(
      state: Draft<FilesSlice>,
      action: PayloadAction<{
        contents: string;
        repoPath: string;
        project: SimulationProject;
      }>
    ) {
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
    },

    deleteFile(state, action: PayloadAction<string>) {
      setters.deleteFile(state, action.payload);
    },

    setCurrentFileId(state, action: PayloadAction<string | null>) {
      setters.setCurrentFileId(state, action.payload);
    },

    closeFile(state, action: PayloadAction<string>) {
      const id = action.payload;
      if (state.openFileIds.includes(id)) {
        setters.removeOpenFileId(state, id);

        if (state.currentFileId === id && state.openFileIds.length > 0) {
          setters.setCurrentFileId(
            state,
            state.openFileIds[state.openFileIds.length - 1]
          );
        }
      }
    },

    closeOtherFiles(state, action: PayloadAction<string>) {
      const id = action.payload;
      // the file we must not close must be set as current
      setters.setCurrentFileId(state, id);
      // edge case: do not close anything if the current file isn't available
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
    },

    closeAllFiles(state, _action: PayloadAction<string>) {
      // edge case: do not close anything if the current file isn't available
      if (!state.openFileIds.length) {
        throw new Error("There are no open files, so we can't close them.");
      }
      const openFileIds = [...state.openFileIds];
      openFileIds.forEach((openFileId) => {
        setters.removeOpenFileId(state, openFileId);
      });
    },

    closeFilesToTheRight(state, action: PayloadAction<string>) {
      const id = action.payload;
      // the file we must not close must be set as current
      setters.setCurrentFileId(state, id);
      // edge case: do not close anything if the current file isn't available
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
    },

    forkOpenBehavior(
      state,
      {
        payload: { destination, source, project },
      }: PayloadAction<{
        destination: ParsedPath;
        source: HcSharedBehaviorFile;
        project: SimulationProject;
      }>
    ) {
      setters.createAndOpenBehaviorTracked(
        state,
        project,
        destination,
        source.contents
      );

      setters.deleteFile(state, source.id);

      const id = mapFileId(destination.base, project.ref);
      const behavior = state.entities[id]!;

      if (behavior.kind !== HcFileKind.Behavior) {
        throw new Error(
          "Cannot create behavior keys file for non-existent behavior"
        );
      }

      behavior.keys = source.keys;
      setters.createBehaviorKeysFile(state, behavior);
    },

    setReplaceProposal(
      state,
      { payload }: PayloadAction<FilesSlice["replaceProposal"]>
    ) {
      setters.setReplaceProposal(state, payload);
    },

    toggleVisualGlobals(state) {
      state.visualGlobals = !state.visualGlobals;
    },

    toggleVisualAnalysis(state) {
      state.visualAnalysis = !state.visualAnalysis;
    },

    addPreparedFile(
      state: Draft<FilesSlice>,
      { payload }: PayloadAction<HcFile>
    ) {
      setters.addFile(state, payload);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(toggleEditor, (state) => {
        setters.setReplaceProposal(state, null);
      })
      .addCase(addDependencies.pending, (state, action) => {
        setters.addPendingDependencies(state, action.meta.arg);
      })
      /**
       * @todo this will cancel pending dependencies that were included in this
       *       request but were also previously pending
       */
      .addCase(addDependencies.rejected, (state, action) => {
        setters.removePendingDependencies(state, action.meta.arg);
      })
      .addCase(addDependencies.fulfilled, (state, action) => {
        setters.addDependencies(state, action.payload);
      })
      .addCase(setProject, (draft, action) => {
        const prevState = current(draft);

        return createNextState(filesInitialState, (state) => {
          const {
            meta: { replaceTabs = true, file } = {},
            project,
          } = action.payload;

          setters.addFiles(state, project.files);

          if (isStoringProjectActions(project)) {
            state.actions = project.actions;
          }

          const openFiles = replaceTabs
            ? DEFAULT_OPEN_FILES
            : prevState.openFileIds;
          for (const id of openFiles) {
            setters.ensureFileOpen(state, id);
          }

          if (file && state.entities[file]) {
            setters.setCurrentFileId(state, file);
          } else {
            setters.setCurrentFileId(
              state,
              replaceTabs ? DEFAULT_CURRENT_FILE : prevState.currentFileId
            );
          }
        });
      })
      .addCase(projectUpdated, (state, action) => {
        const { actions } = action.payload;

        if (actions) {
          const uuids = actions.map((action) => action.uuid);

          state.actions = state.actions.filter(
            (action) => !uuids.includes(action.uuid)
          );
        }
      })
      .addCase(canUserEditProjectUpdate, (state, action) => {
        const map = action.payload.dependencies.reduce<Record<string, boolean>>(
          (map, dep) => {
            map[dep.pathWithNamespace] = dep.canUserEdit;

            return map;
          },
          {}
        );

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
      })
      .addCase(forkAndReleaseBehaviors.fulfilled, (draft, action) => {
        const prevState = current(draft);

        return createNextState(filesInitialState, (state) => {
          const { arg } = action.meta;
          const { files, forkedBehaviors } = action.payload;

          const pairs = Object.fromEntries(
            arg.behaviors.map((behavior) => {
              const prevBehaviorId = mapFileId(behavior.filename, "main");
              const nextBehavior = forkedBehaviors.find(
                (file) => file.repoPath === behavior.path
              );

              if (!prevState.entities[prevBehaviorId]) {
                throw new Error("Could not find original behavior in project");
              }

              if (!nextBehavior) {
                throw new Error(
                  "Could not find new behavior in forked project"
                );
              }

              return [prevBehaviorId, nextBehavior.id];
            })
          );

          setters.addFiles(state, files);

          for (const id of prevState.openFileIds) {
            setters.ensureFileOpen(state, pairs[id] ?? id);
          }

          if (prevState.currentFileId) {
            if (pairs[prevState.currentFileId]) {
              setters.setCurrentFileId(state, pairs[prevState.currentFileId]);
            } else {
              setters.setCurrentFileId(state, prevState.currentFileId);
              state.behaviorKeys = prevState.behaviorKeys;
            }
          }

          state.visualGlobals = prevState.visualGlobals;
        });
      })
      .addCase(parseAndShowBehaviorKeys.fulfilled, (draft, action) => {
        const fileId = action.meta.arg.fileId;
        const file = draft.entities[fileId];

        if (file?.kind !== HcFileKind.Behavior) {
          throw new Error("Cannot find behavior");
        }

        setters.mergeBehaviorKeysWithoutSyncing(draft, file, action.payload);
        setters.syncBehaviorKeys(draft);

        draft.behaviorKeys = true;
        setters.setCurrentFileId(draft, action.meta.arg.fileId);
      })
      .addCase(parseAllBehaviorKeys.fulfilled, (draft, action) => {
        for (const [fileId, keys] of Object.entries(action.payload)) {
          const file = draft.entities[fileId];

          if (file?.kind !== HcFileKind.Behavior) {
            throw new Error("Cannot find behavior");
          }

          setters.mergeBehaviorKeysWithoutSyncing(draft, file, keys);
        }
        setters.syncBehaviorKeys(draft);
      })
      .addCase(beginActionSave, (state, { payload }) => {
        for (const action of state.actions) {
          if (payload.includes(action.uuid)) {
            action.saving = true;
          }
        }
      });
  },
});
