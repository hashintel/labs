import { Draft } from "@reduxjs/toolkit";
import omit from "lodash/omit";
import prettyStringify from "json-stringify-pretty-compact";
import { Json } from "@hashintel/engine-web";

import {
  BehaviorKeysField,
  CommittedBehaviorKeysRoot,
  DraftBehaviorKeysRoot,
  parseKeys,
  recursiveShouldSaveBehaviorKeysDraft,
  toBehaviorKeysFormat,
  toRootDraftFormat,
} from "./behaviorKeys";
import { Ext } from "../../util/files/enums";
import { HcAnyDatasetFile } from "./types";
import type {
  HcAnyDependencyFile,
  HcBehaviorFile,
  HcDatasetFile,
  HcDependencyFile,
  HcFile,
  HcFolder,
  HcInitFile,
  HcProcessModelFile,
  HcRequiredFile,
  HcSharedBehaviorFile,
  HcSharedDatasetFile,
} from "./types";
import { HcFileKind } from "./enums";
import {
  ProjectFile,
  Release,
  ReleaseFile,
  RemoteSimulationProject,
} from "../project/types";
import { nextNonClashingName } from "../../util/nextNonClashingName";
import { parse } from "../../util/files";
import { stripInvalidFileNameCharacters } from "../../util/validation";

export const globalsFileId = "properties";
export const analysisFileId = "analysis";
export const experimentsFileId = "experiments";

/**
 * This is necessary because we try to find these files by ID elsewhere in Core.
 * There are legacy IDs that should be removed
 *
 * @todo remove this
 */
const pathToId: Record<string, string> = {
  "README.md": "description",
  "init.json": "initialState",
  "init.js": "initialState",
  "init.py": "initialState",
  "globals.json": globalsFileId,
  "analysis.json": analysisFileId,
  "dependencies.json": "dependencies",
  "experiments.json": experimentsFileId,
};

export const mapFileId = (path: string, ref?: string | null) =>
  `${path.replace(/_/g, "__").replace(/[^A-Za-z0-9_\\-]/g, "_")}_${(
    ref ?? "main"
  ).replace(/\./g, "_")}`;

export const requiredFileOrder = Object.values(pathToId);

const sortByRequiredFileOrder = (
  a: HcRequiredFile,
  b: HcRequiredFile,
): number => requiredFileOrder.indexOf(a.id) - requiredFileOrder.indexOf(b.id);

const sortByFormatted = (a: HcFile, b: HcFile): number =>
  a.path.formatted.localeCompare(b.path.formatted) ?? 0;

const fileKindOrder: Record<HcFileKind, number> = {
  [HcFileKind.ProcessModel]: -3,
  [HcFileKind.Temporary]: -2,
  [HcFileKind.Folder]: -1,
  [HcFileKind.Required]: 0,
  [HcFileKind.Init]: 1,
  [HcFileKind.Behavior]: 2,
  [HcFileKind.Dataset]: 3,
  [HcFileKind.SharedBehavior]: 4,
};

const sortByFileKindOrder = (a: HcFile, b: HcFile): number =>
  fileKindOrder[a.kind] - fileKindOrder[b.kind];

export const fileSorter = (a: HcFile, b: HcFile): number =>
  a.kind === HcFileKind.Required && b.kind === HcFileKind.Required
    ? sortByRequiredFileOrder(a, b)
    : a.kind === b.kind
      ? sortByFormatted(a, b)
      : sortByFileKindOrder(a, b);

/**
 * When an array contains a typed union, there's no way to make push require a
 * more specific version of that type, which can be useful for code completion
 * and type safety. This allows you to create a function to do that.
 */
const createTypedAdder =
  <A>(arr: A[]) =>
  <T extends A>(...items: T[]) =>
    arr.push(...items);

const datasetFields = (file: ProjectFile | ReleaseFile) => {
  /**
   * We previously had datasets stored in URLs, and so had a system of fetching datasets from URLs.
   * Now, all data is stored within the repo, and so all contents are available immediately.
   * We construct a shim url so that we successfully parse the file type, etc., later on,
   * using the old system which relied on URLs.
   */
  const shimUrl = `https://example.com/${file.name}`;
  const rawCsv = file.name.endsWith(".csv");
  return {
    data: {
      url: shimUrl,
      name: file.name,
      s3Key: "",
      inPlaceData: file.contents,
      rawCsv,
    },
    contents: shimUrl,
    kind: HcFileKind.Dataset as const,
  };
};

type GroupedProjectFile<FileKind extends ProjectFile = ProjectFile> = {
  file: FileKind;
} & (
  | {
      kind: Exclude<
        HcFileKind,
        HcFileKind.Behavior | HcFileKind.SharedBehavior
      >;
    }
  | { kind: HcFileKind.Behavior | HcFileKind.SharedBehavior; keys?: string }
);

const groupFiles = <FileKind extends ProjectFile = ProjectFile>(
  files: FileKind[],
  behaviorKind:
    | HcFileKind.Behavior
    | HcFileKind.SharedBehavior = HcFileKind.Behavior,
) => {
  const grouped = files.reduce<Record<string, GroupedProjectFile<FileKind>>>(
    (grouped, file) => {
      const key = file.path.replace(/\.json$/, "");
      grouped[key] = grouped[key] ?? {};

      const group = grouped[key];
      const isBehavior =
        file.path.startsWith("src/behaviors/") ||
        (file.path.startsWith("dependencies/") &&
          file.path.includes("/src/behaviors/"));

      if (isBehavior && file.path.endsWith(".json")) {
        group.kind = behaviorKind;
        if (group.kind === behaviorKind) {
          group.keys = file.contents;
        }
      } else {
        const isInit =
          file.path === "src/init.json" ||
          file.path === "src/init.js" ||
          file.path === "src/init.py";
        group.file = file;
        group.kind = isBehavior
          ? behaviorKind
          : file.path.startsWith("data") ||
              (file.path.startsWith("dependencies") &&
                file.path.includes("/data/"))
            ? HcFileKind.Dataset
            : isInit
              ? HcFileKind.Init
              : file.path.endsWith(".bpmn")
                ? HcFileKind.ProcessModel
                : HcFileKind.Required;
      }

      return grouped;
    },
    {},
  );

  /**
   * It's possible that we have a keys file without a corresponding file,
   * let's ignore that.
   */
  return Object.values(grouped).filter((group) => group.file);
};

export const releaseToHcFiles = (release: Release): HcDependencyFile[] => {
  const files: HcDependencyFile[] = [];
  const addFile = createTypedAdder(files);
  const groupedFiles = groupFiles(release.files, HcFileKind.SharedBehavior);

  for (const group of groupedFiles) {
    const releaseFile = group.file;
    const parsedPath = parse(releaseFile.dependencyPath);

    const partial = {
      id: mapFileId(releaseFile.dependencyPath, release.tag),
      path: parsedPath,
      repoPath: releaseFile.path,
      contents: releaseFile.contents,
      pathWithNamespace: release.pathWithNamespace,
      name: releaseFile.name,
      latestTag: release.latestReleaseTag,
      canUserEdit: release.canUserEdit,
      ref: releaseFile.ref,
      visibility: release.visibility,
    };

    if (group.kind === HcFileKind.SharedBehavior) {
      addFile<HcSharedBehaviorFile>({
        ...partial,
        kind: HcFileKind.SharedBehavior,
        keys: parseKeys(group.keys, group.kind),
      });
    } else {
      addFile<HcSharedDatasetFile>({
        ...partial,
        ...datasetFields(releaseFile),
      });
    }
  }

  return files;
};

const getProjectFilePath = (projectFile: ProjectFile) => {
  if (projectFile.path.startsWith("@")) {
    return projectFile.path;
  }
  return projectFile.path.split("/").pop()!;
};

export type ProjectFiles = Pick<
  RemoteSimulationProject,
  "files" | "dependencies"
>;

/**
 * @todo take files and dependencies separately
 */
export const toHcFiles = (project: ProjectFiles): HcFile[] => {
  const files: HcFile[] = [];
  const addFile = createTypedAdder(files);
  const groupedFiles = groupFiles(project.files);
  for (const group of groupedFiles) {
    const projectFile = group.file;
    // This is handled in the project slice instead
    if (projectFile.path === "hash.json") {
      continue;
    }
    const path = getProjectFilePath(projectFile);
    const parsedPath = parse(path);

    const partial = {
      id: pathToId[path] ?? mapFileId(parsedPath.base, projectFile.ref),
      path: parsedPath,
      repoPath: projectFile.path,
      contents: projectFile.contents,
    };

    switch (group.kind) {
      case HcFileKind.Behavior:
        addFile<HcBehaviorFile>({
          ...partial,
          kind: HcFileKind.Behavior,
          keys: parseKeys(group.keys, group.kind),
        });
        break;
      case HcFileKind.Dataset:
        addFile<HcDatasetFile>({
          ...partial,
          ...datasetFields(projectFile),
        });
        break;
      case HcFileKind.Folder:
        addFile<HcFolder>({
          ...partial,
          name: parsedPath.dir,
          kind: HcFileKind.Folder,
          children: [],
        });
        break;
      case HcFileKind.Init:
        addFile<HcInitFile>({
          ...partial,
          kind: HcFileKind.Init,
        });
        break;
      case HcFileKind.ProcessModel:
        addFile<HcProcessModelFile>({
          ...partial,
          kind: HcFileKind.ProcessModel,
        });
        break;
      default:
        addFile<HcRequiredFile>({
          ...partial,
          kind: HcFileKind.Required,
        });
        break;
    }
  }

  if (project.dependencies) {
    for (const release of project.dependencies) {
      files.push(...(releaseToHcFiles(release) as HcFile[]));
    }
  }

  files.sort(fileSorter);

  return files;
};

const stringify = (input: Json) => prettyStringify(input, { maxLength: 80 });

export const stringifyAnalysis = (analysis: Json) => stringify(analysis);
export const stringifyExperiments = (experiments: any) =>
  stringify(experiments);
export const stringifyGlobals = (globals: Json) => stringify(globals);

export const fastPrettyStringify = (json: any) =>
  JSON.stringify(json, null, "\t");

export const isSharedDependency = (
  file: HcFile | HcDependencyFile,
): file is HcAnyDependencyFile =>
  Object.prototype.hasOwnProperty.call(file, "pathWithNamespace");

export const behaviorKeyExtensions = [
  Ext.JsJson,
  Ext.PyJson,
  Ext.RsJson,
] as const;

export const isBehaviorKeyFile = (path: string) =>
  behaviorKeyExtensions.some((ext) => path.endsWith(ext));

export const behaviorKeysFileName = (
  behavior: HcBehaviorFile | HcSharedBehaviorFile,
) => `${behavior.path.base}.json`;

export const repoPathForBehavior = (newFileName: string) =>
  `src/behaviors/${newFileName}`;

export const behaviorKeysRowTypes = [
  "any",
  "number",
  "string",
  "boolean",
  "struct",
  "list",
  "fixed_size_list",
] as const;

export const behaviorKeysRowTemplate: BehaviorKeysField = {
  type: behaviorKeysRowTypes[1],
  nullable: true,
};

export const behaviorKeysTopLevelRowTemplate: BehaviorKeysField = {
  ...behaviorKeysRowTemplate,
  type: "any",
};

export const defaultBehaviorKeys: DraftBehaviorKeysRoot = {
  keys: toRootDraftFormat({}),
  built_in_key_use: null,
  dynamic_access: false,
  _trackCreation: false,
};

/**
 * @todo type this
 * @todo clean up
 */
export const parseRelativePathsAsTree = (
  files: Pick<HcFile, "id" | "name" | "repoPath">[],
) => {
  const result: any[] = [];
  const level = { result };

  files.forEach((file) => {
    if (!file.repoPath) {
      return; // only process if fullPathPropertyName is available
    }
    const splittedPath = file.repoPath.split("/");
    const reduceFn = (
      accumulator: any,
      currentValue: string,
      currentIndex: number,
    ) => {
      if (!accumulator[currentValue]) {
        accumulator[currentValue] = { result: [] };
        const children = accumulator[currentValue].result;
        const isFolder = currentValue.split(".").length === 1; // TODO: confirm we prevent periods in folder names
        const tmp = { ...file, name: currentValue, children };
        if (isFolder) {
          tmp.repoPath = splittedPath.slice(0, currentIndex + 1).join("/");
        }
        accumulator.result.push(tmp);
      }
      return accumulator[currentValue];
    };
    splittedPath.reduce(reduceFn, level);
  });

  return result;
};

export const canAutosuggestKeysForFile = (
  file: HcBehaviorFile | HcSharedBehaviorFile,
) => file.path.ext === Ext.Js || file.path.ext === Ext.Py;

export const allocateDatasetFileName = (
  originalFileName: string,
  datasets: HcAnyDatasetFile[],
) => {
  const existingNames = datasets
    .filter((dataset) => !isSharedDependency(dataset))
    .map((dataset) => dataset.path.name);

  const [originalFileNameBase, ...fileNameExtensions] =
    originalFileName.split(".");

  const allocatedFileNameBase = nextNonClashingName(
    stripInvalidFileNameCharacters(originalFileNameBase),
    existingNames,
  );

  const fileExtension = fileNameExtensions.length
    ? `.${fileNameExtensions.join(".")}`
    : "";

  return `${allocatedFileNameBase}${fileExtension}`;
};

export const isReadOnly = (file: HcFile, canEdit: boolean) =>
  canEdit
    ? file.kind === HcFileKind.SharedBehavior ||
      file.kind === HcFileKind.Dataset ||
      file.id === "dependencies"
    : file.id !== globalsFileId;

export const behaviorKeysRepoPath = (behavior: Draft<HcBehaviorFile>) =>
  repoPathForBehavior(behaviorKeysFileName(behavior));

export const stringifyBehaviorKeys = (
  behavior: HcBehaviorFile | HcSharedBehaviorFile,
) => {
  const committed: CommittedBehaviorKeysRoot = {
    ...omit(behavior.keys, "_trackCreation"),
    keys: toBehaviorKeysFormat(behavior.keys.keys).fields,
    _draft_keys: recursiveShouldSaveBehaviorKeysDraft(behavior.keys.keys)
      ? behavior.keys.keys
      : undefined,
  };

  return fastPrettyStringify(committed);
};
