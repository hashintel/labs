import { ProjectVisibility } from "../../../features/project/types";

export type NewProjectModalValues = {
  name: string;
  path: string;
  namespace: string;
  visibility: ProjectVisibility;
};
