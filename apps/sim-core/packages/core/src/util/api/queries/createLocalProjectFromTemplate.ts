import { parse } from "../../files";
import { CommitActionVerb } from "../apiTypes";
import { ApiCommitAction } from "../types";
import {
  LocalStorageProject,
  ProjectVisibility,
  SimulationProjectWithHcFiles,
} from "../../../features/project/types";
import { toHcConfig } from "../../../features/project/utils";
import { toHcFiles } from "../../../features/files/utils";
import { setLocalStorageProject } from "../../../features/middleware/localStorage";
import { USER_ORG_VALUE } from "../../../components/Modal/NewProject/utils";

/**
 * Creates a new project locally from template actions (no server call).
 * Used for local-first mode.
 */
export const createLocalProjectFromTemplate = (
  namespace: string,
  path: string,
  name: string,
  visibility: ProjectVisibility,
  actions: ApiCommitAction[]
): SimulationProjectWithHcFiles => {
  const effectiveNamespace =
    !namespace || namespace === USER_ORG_VALUE ? "user" : namespace;
  const pathWithNamespace =
    effectiveNamespace === "user" ? path : `@${effectiveNamespace}/${path}`;
  const ref = "main";
  const now = new Date().toISOString();

  const projectFiles = actions
    .filter((a) => a.action === CommitActionVerb.Create && a.content != null)
    .map((a) => ({
      name: parse(a.filePath).base,
      path: a.filePath,
      contents: a.content!,
      ref,
    }));

  const hashJson = {
    keywords: [] as string[],
    type: "Simulation" as const,
    files: projectFiles
      .filter((f) => !f.path.endsWith(".json"))
      .map((f) => f.path),
  };
  projectFiles.push({
    name: "hash.json",
    path: "hash.json",
    contents: JSON.stringify(hashJson, null, 2),
    ref,
  });

  const remoteProject = {
    id: pathWithNamespace,
    name,
    pathWithNamespace,
    namespace: effectiveNamespace,
    type: "Simulation" as const,
    ref,
    visibility,
    canUserEdit: true,
    ownerType: "User" as const,
    forkOf: null,
    createdAt: now,
    updatedAt: now,
    keywords: [],
    files: projectFiles,
    dependencies: [],
  };

  const project: LocalStorageProject = {
    ...remoteProject,
    config: toHcConfig(remoteProject),
    files: toHcFiles(remoteProject),
    actions: [],
  };

  setLocalStorageProject(project);
  return project;
};
