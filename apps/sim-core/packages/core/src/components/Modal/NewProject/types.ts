import { ProjectVisibility } from "../../../features/project/types";

export interface NewProjectModalValues {
  name: string;
  path: string;
  namespace: string;
  visibility: ProjectVisibility;
}
