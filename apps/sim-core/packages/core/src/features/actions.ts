/**
 * Shared action creators. These are still used by Redux slice extraReducers
 * and by the context-based state management (dispatched to useReducer).
 * The setProjectWithMeta thunk is deprecated; use ProjectContext.setProjectWithMeta instead.
 */
import { createAction } from "@reduxjs/toolkit";

import type { Commit } from "../util/api/auto-types";
import type {
  CanUserEditProject,
  LocalStorageProject,
  SimulationProject,
  SimulationProjectWithHcFiles,
} from "./project/types";
import { FileAction } from "./files/types";
import { Scope } from "./scopes";

export type CommitWithoutStats = Omit<Commit, "stats">;

type SetProjectParams = {
  project: SimulationProjectWithHcFiles | LocalStorageProject;
  meta: {
    fromLegacy?: boolean;
    replaceTabs?: boolean;
    file?: string;
  };
  scopes: Record<Scope.edit | Scope.mutate, boolean>;
};

export const setProject = createAction<SetProjectParams>("shared/setProject");

/**
 * @deprecated Use ProjectContext.setProjectWithMeta instead.
 * Kept temporarily for any remaining callers during migration.
 */
export const setProjectWithMeta = (
  project: SetProjectParams["project"],
  meta: SetProjectParams["meta"] = {},
) => {
  console.warn("setProjectWithMeta from actions.ts is deprecated; use ProjectContext");
  return setProject({
    project,
    meta,
    scopes: { [Scope.edit]: true, [Scope.mutate]: true },
  });
};

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
