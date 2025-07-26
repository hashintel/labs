import {
  PartialProjectByPathQuery,
  PartialProjectByPathQueryVariables,
} from "../types";
import { PartialSimulationProject } from "../../../features/project/types";
import { preparePartialSimulationProject } from "../../../features/project/utils";
import { query } from "../query";

export const PartialProjectFragment = /* GraphQL */ `
  fragment PartialProjectFragment on Project {
    pathWithNamespace
    name
    updatedAt
    type
    visibility
    latestRelease {
      createdAt
      tag
    }
    forkOf {
      pathWithNamespace
    }
  }
`;

const queryString = /* GraphQL */ `
  query partialProjectByPath($pathWithNamespace: String!, $version: String!) {
    project(projectPath: $pathWithNamespace, ref: $version) {
      ...PartialProjectFragment
    }
  }

  ${PartialProjectFragment}
`;

export const partialProjectByPath = async (
  pathWithNamespace: string,
  version: string,
  signal?: AbortSignal,
): Promise<PartialSimulationProject> => {
  const { project } = await query<
    PartialProjectByPathQuery,
    PartialProjectByPathQueryVariables
  >(queryString, { pathWithNamespace, version }, signal);

  return preparePartialSimulationProject(project);
};
