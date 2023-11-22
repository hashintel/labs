import {
  CanUserEditProjectQuery,
  CanUserEditProjectQueryVariables,
} from "../auto-types";
import { query } from "../query";

const queryString = /* GraphQL */ `
  query canUserEditProject($pathWithNamespace: String!, $ref: String!) {
    project(projectPath: $pathWithNamespace, ref: $ref) {
      canUserEdit
      dependencies {
        pathWithNamespace
        canUserEdit
      }
    }
  }
`;

export const canUserEditProject = async (
  pathWithNamespace: string,
  ref: string,
) =>
  (
    await query<CanUserEditProjectQuery, CanUserEditProjectQueryVariables>(
      queryString,
      { pathWithNamespace, ref },
    )
  ).project;
