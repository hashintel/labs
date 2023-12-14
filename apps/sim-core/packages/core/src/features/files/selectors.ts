import { createSelector, Dictionary, Selector } from "@reduxjs/toolkit";
import { createSelectorCreator, defaultMemoize } from "reselect";
import { isEqualWith, pick, sortBy } from "lodash";

import type {
  DependenciesDescriptor,
  FilesSlice,
  HcAnyDatasetFile,
  HcAnyDependencyFile,
  HcBehaviorFile,
  HcFile,
  HcInitFile,
  HcRequiredFile,
  HcSharedBehaviorFile,
} from "./types";
import { Ext } from "../../util/files/enums";
import { HcFileKind } from "./enums";
import type { RootState } from "../types";
import type { SimulationSrc } from "../../util/types";
import {
  analysisFileId,
  globalsFileId,
  isSharedDependency,
  parseRelativePathsAsTree,
} from "./utils";
import { getSelectors } from "./adapter";
import { parseAnalysis } from "../../components/Analysis/utils";
import { selectEditorVisible } from "../viewer/selectors";

/**
 * calling `getSelectors` without any arguments produces selectors that can be
 * called with the files slice state as `state` (useful within slice case
 * reducers, and extra reducers)
 */
export const {
  selectIds: selectFileIdsLocal,
  selectEntities: selectFileEntitiesLocal,
  selectAll: selectAllFilesLocal,
  selectTotal: selectTotalFilesLocal,
  selectById: selectFileByIdLocal,
} = getSelectors();

export const selectFilesSlice: Selector<RootState, FilesSlice> = (state) =>
  state.files;

/**
 * calling `getSelectors` with a "slice selector" produces selectors that can be
 * called with the root/store state as `state` (useful for components, across
 * slices, & for middlewares)
 */
export const {
  selectIds: selectFileIds,
  selectEntities: selectFileEntities,
  selectAll: selectAllFiles,
  selectTotal: selectTotalFiles,
  selectById: selectFileById,
} = getSelectors<RootState>(selectFilesSlice);

/**
 * if you need to create a selector that depends on a specific field from
 * another selector use these this function, as it will memoize correctly and
 * prevent unnecessary re-renders.
 *
 * @see https://github.com/hashintel/internal/issues/1304
 * @todo Remove this when the above issue is fixed
 */

const createCompareEqualForKeySelector =
  (keySelector: (_: unknown, __: unknown, key: any) => boolean | undefined) =>
  (currentEntities: any, previousEntities: any) => {
    if (currentEntities.length !== previousEntities.length) {
      return false;
    }

    for (let idx = 0; idx < currentEntities.length; idx++) {
      const currentEntity = currentEntities[idx];
      const previousEntity = previousEntities[idx];

      if (!isEqualWith(currentEntity, previousEntity, keySelector)) {
        return false;
      }
    }

    return true;
  };

export const createFieldSelector = <T, F extends keyof T>(
  selector: (state: any) => T[],
  field: F,
) =>
  createSelectorCreator(
    defaultMemoize,
    createCompareEqualForKeySelector((curr, prev, key) =>
      !key || field === key ? undefined : true,
    ),
  )([selector], (entities: T[]) => entities.map((entity) => entity[field]));

export const createFieldsSelector = <T, F extends keyof T>(
  selector: (state: any) => T[],
  fields: F[],
) =>
  createSelectorCreator(
    defaultMemoize,
    createCompareEqualForKeySelector((curr, prev, key) =>
      !key || fields.includes(key) ? undefined : true,
    ),
  )([selector], (entities: T[]) =>
    entities.map((entity) => pick(entity, fields) as Pick<T, F>),
  );

export const selectIdKindAndPathFromFiles = createFieldsSelector(
  selectAllFiles,
  ["id", "kind", "path"],
);

export const selectCurrentFileId = createSelector(
  [selectFilesSlice, selectEditorVisible],
  (files, editorVisible) =>
    editorVisible
      ? files.currentFileId
      : files.entities.properties
        ? globalsFileId
        : null,
);

export const selectReplaceProposal = createSelector(
  [selectFilesSlice, selectEditorVisible],
  (files, editorVisible) => {
    const proposal = editorVisible ? files.replaceProposal : null;

    return {
      proposal: proposal,
      file: proposal?.fileId ? files.entities[proposal.fileId] : null,
    };
  },
);

export const selectCurrentFile = createSelector(
  [selectFileEntities, selectCurrentFileId],
  (entities, currentFileId) =>
    currentFileId ? entities[currentFileId] : undefined,
);

export const selectCurrentBehavior = createSelector(
  [selectCurrentFile],
  (file): HcBehaviorFile | HcSharedBehaviorFile | undefined =>
    file?.kind === HcFileKind.Behavior ||
    file?.kind === HcFileKind.SharedBehavior
      ? file
      : undefined,
);

export const selectOpenFileIds = createSelector(
  [selectFilesSlice, selectEditorVisible],
  (files, editorVisible) =>
    editorVisible
      ? files.openFileIds
      : files.entities.properties
        ? [globalsFileId]
        : [],
);

export const selectOpenFiles = createSelector<
  RootState,
  Dictionary<HcFile>,
  string[],
  HcFile[]
>(selectFileEntities, selectOpenFileIds, (entities, openFileIds) =>
  openFileIds.map((openFileId) => (entities as any)[openFileId]),
);

export const selectRequiredFiles = createSelector(
  selectAllFiles,
  (files) =>
    files.filter(
      (file) => file.kind === HcFileKind.Required,
    ) as HcRequiredFile[],
);

export const selectRequiredIds = createFieldSelector(selectRequiredFiles, "id");

export const selectDescriptionFile: Selector<RootState, HcFile | undefined> = (
  state,
) => selectFileById(state, "description");

export const selectDescription = createSelector(
  selectDescriptionFile,
  (file) => file?.contents,
);

export const selectDependenciesFile: Selector<RootState, HcFile | undefined> = (
  state,
) => selectFileById(state, "dependencies");

export const selectDependencies = createSelector(
  selectDependenciesFile,
  (file) => file?.contents,
);

export const selectParsedDependencies = createSelector(
  selectDependencies,
  (json): DependenciesDescriptor => {
    let result;
    try {
      result = json ? JSON.parse(json) : {};
    } catch (exception) {
      return {};
    }
    return result;
  },
);

export const selectLocalBehaviorFiles = createSelector(
  selectAllFiles,
  (files) =>
    files.filter(
      (file) => file.kind === HcFileKind.Behavior,
    ) as HcBehaviorFile[],
);

export const selectInitFiles = createSelector(
  selectAllFiles,
  (files) =>
    files.filter((file) => file.kind === HcFileKind.Init) as HcInitFile[],
);

export const selectLocalBehaviorIds = createFieldSelector(
  selectLocalBehaviorFiles,
  "id",
);

export const selectEditableFiles = createSelector(selectAllFiles, (files) =>
  files.filter(
    (file) =>
      file.kind === HcFileKind.Required ||
      file.kind === HcFileKind.Behavior ||
      file.kind === HcFileKind.Init,
  ),
);

export const selectDatasetFiles = createSelector(
  selectAllFiles,
  (files) =>
    files.filter(
      (file) => file.kind === HcFileKind.Dataset,
    ) as HcAnyDatasetFile[],
);

export const selectDatasetFilesLocal = createSelector(
  selectAllFilesLocal,
  (files) =>
    files.filter(
      (file) => file.kind === HcFileKind.Dataset,
    ) as HcAnyDatasetFile[],
);

export const selectDatasetIds = createFieldSelector(selectDatasetFiles, "id");

export const selectSharedBehaviorFiles = createSelector(
  selectAllFiles,
  (files) =>
    files.filter((file) => {
      // Dependencies migration shim to force our dependencies to behave as shared behaviorss.
      return (
        file.kind === HcFileKind.SharedBehavior ||
        (file.kind === HcFileKind.Behavior &&
          file.repoPath.startsWith("dependencies/"))
      );
    }) as HcSharedBehaviorFile[],
);

export const selectSharedBehaviorFilesLocal = createSelector(
  selectAllFilesLocal,
  (files) =>
    files.filter(
      (file) => file.kind === HcFileKind.SharedBehavior,
    ) as HcSharedBehaviorFile[],
);

export const selectSharedBehaviorIds = createFieldSelector(
  selectSharedBehaviorFiles,
  "id",
);

export const selectGlobalsFile: Selector<RootState, HcFile | undefined> = (
  state,
) => selectFileById(state, globalsFileId);

export const selectGlobals = createSelector(
  selectGlobalsFile,
  (file) => file?.contents,
);

export const selectAnalysisFile: Selector<RootState, HcFile | undefined> = (
  state,
) => selectFileById(state, analysisFileId);

export const selectAnalysis = createSelector(
  selectAnalysisFile,
  (file) => file?.contents,
);

export const selectParsedAnalysis = createSelector(
  selectAnalysis,
  (analysisString) => parseAnalysis(analysisString).analysis,
);

export const selectParsedAnalysisMetricNames = createSelector(
  selectParsedAnalysis,
  (analysis) => {
    if (
      analysis &&
      typeof analysis === "object" &&
      "outputs" in analysis &&
      analysis.outputs &&
      typeof analysis.outputs === "object"
    ) {
      return Object.keys(analysis.outputs);
    }

    return [];
  },
);

export const selectExperimentsFile: Selector<RootState, HcFile | undefined> = (
  state,
) => selectFileById(state, "experiments");

export const selectExperimentsSrc = createSelector(
  selectExperimentsFile,
  (file) => file?.contents,
);

export const selectProcessModelSourceFiles = createSelector(
  selectAllFiles,
  (files) => files.filter((file) => file.kind === HcFileKind.ProcessModel),
);

export const selectSimulationSrc = createSelector(
  [selectRequiredFiles, selectLocalBehaviorFiles, selectInitFiles],
  (requiredFiles, behaviorFiles, initFiles): SimulationSrc => {
    /**
     * the ids of required files that wind up in the simulation key of our
     * project object (e.g. every required file id *except* "description")
     */
    const ids = [globalsFileId, "analysis", "dependencies", "experiments"];

    /**
     * this would be cheaper to do as a single `reduce` pass, but I can't get
     * the types to check out … I think this is only working now because of some
     * type confusion, the return value is `any` but the `createSelector`
     * generics specify that it should be `SimulationSrc` ¯\_(ツ)_/¯
     */
    const pairs = ids
      .map((id) => [
        id + "Src",
        requiredFiles.find((file) => file.id === id)?.contents,
      ])
      .filter((pair) => pair[1] !== undefined);

    return pairs.length !== ids.length
      ? undefined
      : {
          ...Object.fromEntries(pairs),
          initializers: initFiles.map((file) => ({
            id: file.id,
            name: file.path.formatted,
            initSrc: file.contents,
          })),
          behaviors: behaviorFiles.map((file) => ({
            id: file.id,
            name: file.path.formatted,
            dependencies: [],
            behaviorSrc: file.contents,
          })),
        };
  },
);

export const selectSimulationRequiresPyodide = createSelector(
  [selectSimulationSrc, selectSharedBehaviorFiles],
  (simulationSrc, sharedBehaviors) =>
    sharedBehaviors.some((behavior) => behavior.path.ext === Ext.Py) ||
    simulationSrc.behaviors.some((behavior) => behavior.name.includes(".py")) ||
    simulationSrc.initializers.some((init) => init.name.includes(".py")),
);

export const selectPendingDependencies = createSelector(
  selectFilesSlice,
  (slice) => slice.pendingDependencies,
);

export const selectFileActions = createSelector(
  selectFilesSlice,
  (slice) => slice.actions,
);

export const selectDidSave = createSelector(
  selectFileActions,
  (actions) => actions.length === 0,
);

export const selectPrivateDependencies = createSelector(
  [selectDatasetFiles, selectSharedBehaviorFiles],
  (datasets, sharedBehaviors) =>
    [...datasets, ...sharedBehaviors].filter(
      (file): file is HcAnyDependencyFile =>
        isSharedDependency(file) && file.visibility === "private",
    ),
);

export const selectProjectHasPrivateDependencies = createSelector(
  selectPrivateDependencies,
  (deps) => deps.length > 0,
);

const behaviorToBehaviorKeyNamesCombinator = (
  files: (HcBehaviorFile | HcSharedBehaviorFile)[],
) => [
  ...new Set(files.flatMap((file) => file.keys.keys.rows.map((row) => row[0]))),
];

export const selectLocalBehaviorKeyFieldNames = createSelector(
  [selectLocalBehaviorFiles],
  behaviorToBehaviorKeyNamesCombinator,
);

export const selectSharedBehaviorKeyFieldNames = createSelector(
  [selectSharedBehaviorFiles],
  behaviorToBehaviorKeyNamesCombinator,
);

export const selectShouldShowBehaviorKeys = createSelector(
  [selectFilesSlice, selectCurrentBehavior],
  (slice, behavior) => slice.behaviorKeys && !!behavior,
);

export const selectBehaviorKeysDynamicAccess = createSelector(
  selectCurrentBehavior,
  (file) => file?.keys.dynamic_access ?? false,
);

export const selectCurrentFileRepoPath = createSelector(
  selectCurrentFile,
  (file) => file?.repoPath ?? null,
);

const selectFilesIdRepoPathName = createFieldsSelector(selectAllFiles, [
  "id",
  "kind",
  "repoPath",
  "name",
]);

export const selectFolderTree = createSelector(
  selectFilesIdRepoPathName,
  (files) => {
    const filteredFiles = files.filter(
      (file) => file.kind !== HcFileKind.ProcessModel,
    );
    return sortBy(
      parseRelativePathsAsTree(filteredFiles),
      [
        (item) => item.children.length === 0,
        (item) => item.repoPath.toLowerCase(),
      ],
      ["asc", "asc"],
    );
  },
);
