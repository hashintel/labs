import { EntityState } from "@reduxjs/toolkit";
import { JSONSchema7 } from "json-schema";
import { Json, JsonMap } from "@hashintel/engine-web";

import { DraftBehaviorKeysRoot } from "./behaviorKeys";
import type { HcFileKind } from "./enums";
import { LinkableProject, ProjectVisibility } from "../project/types";
import type { ParsedPath } from "../../util/files/types";

export interface HcBaseFile<K extends HcFileKind = HcFileKind> {
  id: string;
  contents: string;
  kind: K;
  path: ParsedPath;
  repoPath: string;
  children?: Array<HcFile | HcFolder>;
  name?: string;
}

type HcDependencyFileKind = HcFileKind.Dataset | HcFileKind.SharedBehavior;
export type HcDependencyFile<
  K extends HcDependencyFileKind = HcDependencyFileKind
> = HcBaseFile<K> &
  LinkableProject & {
    name: string;
    latestTag: string | null;
    canUserEdit: boolean;
    ref: NonNullable<LinkableProject["ref"]>;
    visibility: ProjectVisibility;
  };

export type DatasetFields = {
  data: {
    name?: string;
    rawCsv?: boolean;
    s3Key: string;
    inPlaceData: string | null;
  };
};

type BehaviorFields = {
  keys: DraftBehaviorKeysRoot;
};

export interface HcTemporaryFile extends HcBaseFile<HcFileKind.Temporary> {
  name?: string;
}

export interface HcRequiredFile extends HcBaseFile<HcFileKind.Required> {}

export interface HcBehaviorFile
  extends HcBaseFile<HcFileKind.Behavior>,
    BehaviorFields {}

export interface HcDatasetFile
  extends HcBaseFile<HcFileKind.Dataset>,
    DatasetFields {}

export type HcSharedDatasetFile = HcDependencyFile<HcFileKind.Dataset> &
  DatasetFields;

export type HcAnyDatasetFile = HcDatasetFile | HcSharedDatasetFile;

/**
 * @todo update this to be HcFileKind.Behavior when SharedBehavior has been
 *       removed
 */
export type HcSharedBehaviorFile = HcDependencyFile<HcFileKind.SharedBehavior> &
  BehaviorFields;

export interface HcFolder extends HcBaseFile<HcFileKind.Folder> {
  name: string;
  children: Array<HcFolder | HcFile>;
}

export interface HcInitFile extends HcBaseFile<HcFileKind.Init> {}

export type HcProcessModelFile = HcBaseFile<HcFileKind.ProcessModel>;

export type HcFile =
  | HcTemporaryFile
  | HcRequiredFile
  | HcBehaviorFile
  | HcDatasetFile
  | HcSharedDatasetFile
  | HcSharedBehaviorFile
  | HcFolder
  | HcInitFile
  | HcProcessModelFile;

export type HcAnyDependencyFile = HcSharedDatasetFile | HcSharedBehaviorFile;

export type FileAction = {
  uuid: string;
  repoPath: string;
  contents?: string;
  saving: boolean;
} & (
  | { type: "create" }
  | { type: "update"; contents: string }
  | { type: "move"; oldRepoPath: string }
  | { type: "delete" }
);

export type ParsedGlobals = JsonMap & { schema?: JSONSchema7 | Json };
export type ParsedAnalysis = Json;

export interface FilesSlice extends EntityState<HcFile> {
  openFileIds: string[];
  currentFileId: string | null;
  replaceProposal: null | {
    fileId: string;
    nextContents: string;
  };
  pendingDependencies: string[];
  actions: FileAction[];
  behaviorKeys: boolean;
  visualGlobals: boolean;
  visualAnalysis: boolean;
}

export type DependenciesDescriptor = { [name: string]: string };
