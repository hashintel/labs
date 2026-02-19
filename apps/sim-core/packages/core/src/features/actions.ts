/**
 * Shared action creators used by multiple context providers.
 * Pure implementations (no Redux Toolkit dependency).
 */
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

interface TypedAction<T extends string, P = void> {
  type: T;
  payload: P;
}

export const setProject = (
  payload: SetProjectParams,
): TypedAction<"shared/setProject", SetProjectParams> => ({
  type: "shared/setProject",
  payload,
});
setProject.type = "shared/setProject" as const;

/**
 * @deprecated Use ProjectContext.setProjectWithMeta instead.
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

type ProjectUpdatedPayload = {
  updatedAt: string;
  update?: Omit<Partial<SimulationProject>, "updatedAt" | "pathWithNamespace">;
  actions?: Pick<FileAction, "uuid">[];
  commit?: CommitWithoutStats;
};

export const projectUpdated = (
  payload: ProjectUpdatedPayload,
): TypedAction<"shared/projectUpdated", ProjectUpdatedPayload> => ({
  type: "shared/projectUpdated",
  payload,
});
projectUpdated.type = "shared/projectUpdated" as const;

export const canUserEditProjectUpdate = (
  payload: CanUserEditProject,
): TypedAction<"shared/canUserEditProjectUpdate", CanUserEditProject> => ({
  type: "shared/canUserEditProjectUpdate",
  payload,
});
canUserEditProjectUpdate.type = "shared/canUserEditProjectUpdate" as const;

export const beginActionSave = (
  payload: string[],
): TypedAction<"shared/beginActionSave", string[]> => ({
  type: "shared/beginActionSave",
  payload,
});
beginActionSave.type = "shared/beginActionSave" as const;
