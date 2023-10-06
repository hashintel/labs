import { FileAction } from "../../../features/files/types";
import { FullProjectFragment } from "./unpreparedProjectByPath";
import {
  ProjectVisibility,
  RemoteSimulationProject,
} from "../../../features/project/types";
import { commitActions } from "./commitActions";
import { prepareRemoteProject } from "./utils";
import { query } from "../query";

/**
 * @todo commit actions in some query as fork
 */
export const forkProjectQuery = async (
  projectPath: string,
  ref: string,
  name: string,
  namespace: string,
  path: string,
  visibility: ProjectVisibility,
  actions: FileAction[] = []
) => {
  const remoteProject = (
    await query<{ forkAndUpdate: RemoteSimulationProject }>(
      `
        mutation forkProject(
          $projectPath: String!,
          $ref: String!,
          $name: String!,
          $namespace: String,
          $path: String!,
          $visibility: VisibilityLevel!
        ) {
          forkAndUpdate(
            projectPath: $projectPath,
            ref: $ref,
            name: $name,
            namespace: $namespace,
            path: $path,
            update: { visibility: $visibility }
          ) {
             ...FullProjectFragment
          }
        }
        
        ${FullProjectFragment}
      `,
      {
        projectPath: projectPath,
        ref: ref,
        name: name,
        namespace: namespace,
        path: path,
        visibility: visibility,
      }
    )
  ).forkAndUpdate;
  if (actions.length) {
    return await commitActions(
      remoteProject.pathWithNamespace,
      actions,
      true
    ).then((res) => res.result);
  }

  return prepareRemoteProject(remoteProject, null);
};
