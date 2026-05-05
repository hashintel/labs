import { ApiCommitAction } from "../types";
import { FullProjectFragment } from "./unpreparedProjectByPath";
import {
  ProjectVisibility,
  RemoteSimulationProject,
  SimulationProjectWithHcFiles,
} from "../../../features/project/types";
import { prepareRemoteProject } from "./utils";
import { query } from "../query";

export const createNewSimulationProject = async (
  namespace: string,
  path: string,
  name: string,
  visibility: ProjectVisibility,
  actions: ApiCommitAction[],
): Promise<SimulationProjectWithHcFiles> =>
  prepareRemoteProject(
    (
      await query<{
        createProject: RemoteSimulationProject;
      }>(
        `
          mutation CreateProject ($name: String!, $path: String!, $namespace: String, $visibility: VisibilityLevel, $actions: [CommitAction!]!) {
            createProject(type: Simulation, name: $name, path: $path, namespace: $namespace, visibility: $visibility, actions: $actions) {
              ...FullProjectFragment
            }
          }
          
          ${FullProjectFragment}
        `,
        { path, visibility, name, namespace, actions },
      )
    ).createProject,
    null,
  );
