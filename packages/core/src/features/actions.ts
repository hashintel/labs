/**
 * This file is only for actions that are shared between features
 */
import { createAction } from "@reduxjs/toolkit";

import { AppThunk } from "./types";
import type {
  CanUserEditProject,
  LocalStorageProject,
  SimulationProject,
  SimulationProjectWithHcFiles,
} from "./project/types";
import { CommitWithoutStats } from "../util/api/queries/commitActions";
import { FileAction } from "./files/types";
import { Scope, batchedScopes } from "./scopes";

interface SetProjectParams {
  project: SimulationProjectWithHcFiles | LocalStorageProject;
  meta: {
    fromLegacy?: boolean;
    replaceTabs?: boolean;
    file?: string;
  };
  scopes: Record<Scope.edit | Scope.mutate, boolean>;
}
/**
 * @todo this should handle navigate
 * @todo this will need to be handled in the examples / user projects in case
 *       name has changed
 * @todo check that all calls to this properly set replaceTabs
 * @todo hide setProject within setProjectWithMeta so it cannot be called on its
 *       own
 */
export const setProject = createAction<SetProjectParams>("shared/setProject");

export const setProjectWithMeta =
  (
    project: SetProjectParams["project"],
    meta: SetProjectParams["meta"] = {},
  ): AppThunk =>
  (dispatch, getState) =>
    dispatch(
      setProject({
        project,
        meta,
        scopes: batchedScopes.selectScopes(getState())(project),
      }),
    );

export const projectUpdated = createAction<{
  updatedAt: string;
  update?: Omit<Partial<SimulationProject>, "updatedAt" | "pathWithNamespace">;
  actions?: Pick<FileAction, "uuid">[];
  commit?: CommitWithoutStats;
}>("shared/projectUpdated");

export const canUserEditProjectUpdate = createAction<CanUserEditProject>(
  "shared/canUserEditProjectUpdate",
);

export const beginActionSave = createAction<string[]>("shared/beginActionSave");
