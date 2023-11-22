import {
  Commit,
  CommitActionsMutation,
  CommitActionsMutationVariables,
} from "../auto-types";
import { FileAction } from "../../../features/files/types";
import { FullProjectFragment } from "./unpreparedProjectByPath";
import { SimulationProjectWithHcFiles } from "../../../features/project/types";
import { parse } from "../../files";
import { prepareRemoteProject } from "./utils";
import { query } from "../query";
import { toRepoCommitAction } from "../utils";

const toFileName = (path: string) => parse(path).base;

/**
 * @todo move this
 */
export type CommitWithoutStats = Omit<Commit, "stats">;

const queryString = /* GraphQL */ `
  mutation commitActions(
    $pathWithNamespace: String!
    $actions: [CommitAction!]!
    $message: String!
    $includeFullProject: Boolean!
    $accessCode: String
  ) {
    createCommit(
      projectPath: $pathWithNamespace
      message: $message
      actions: $actions
      accessCode: $accessCode
    ) {
      project @skip(if: $includeFullProject) {
        updatedAt
      }
      project @include(if: $includeFullProject) {
        ...FullProjectFragment
      }
      commit {
        id
        message
        createdAt
      }
    }
  }

  ${FullProjectFragment}
`;

/**
 * @warning this is not cancellable
 */
export async function commitActions<
  IncludeFullProject extends boolean,
  Result extends IncludeFullProject extends true
    ? SimulationProjectWithHcFiles
    : string,
>(
  pathWithNamespace: string,
  actions: FileAction[],
  includeFullProject: IncludeFullProject,
  accessCode?: string,
): Promise<{ result: Result; commit: CommitWithoutStats }> {
  const result = await query<
    CommitActionsMutation,
    CommitActionsMutationVariables
  >(queryString, {
    includeFullProject,
    pathWithNamespace,
    actions: actions.map(toRepoCommitAction),
    message: `[CORE] ${actions
      .map(toRepoCommitAction)
      .map(
        (action) =>
          `${action.action}: ${
            action.previousPath
              ? `${toFileName(action.previousPath)} → ${toFileName(
                  action.filePath,
                )}`
              : toFileName(action.filePath)
          }`,
      )
      .join(", ")}`,
    accessCode,
  });
  const { project, commit } = result.createCommit;

  // The generated types don't understand that the combination of directives
  // ensures the project will always be defined, so we have to assert it.
  if ("pathWithNamespace" in project!) {
    return {
      result: prepareRemoteProject(project, null) as Result,
      commit,
    };
  } else {
    return { result: project!.updatedAt, commit };
  }
}
