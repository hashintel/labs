import { LinkableProject } from "../features/project/types";
import { urlFromProject } from "../routes";

export const localStorageProjectKey = (project: LinkableProject) =>
  `project${urlFromProject(project)}`;
