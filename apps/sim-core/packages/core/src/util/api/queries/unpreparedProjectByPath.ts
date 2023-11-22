import { ProjectByPathQuery, ProjectByPathQueryVariables } from "../auto-types";
import { query } from "../query";

export const FilesFragment = /* GraphQL */ `
  fragment FilesFragment on Project {
    files {
      name
      path
      contents
      ref
    }

    dependencies {
      pathWithNamespace
      tag
      latestReleaseTag
      canUserEdit
      visibility
      files {
        name
        path
        dependencyPath
        contents
        ref
      }
    }
  }
`;

export const FullProjectFragment = /* GraphQL */ `
  fragment FullProjectFragment on Project {
    id
    name
    description
    image
    thumbnail
    createdAt
    updatedAt
    canUserEdit
    pathWithNamespace
    namespace
    type
    ref
    visibility
    ownerType
    forkOf {
      pathWithNamespace
    }
    latestRelease {
      tag
      createdAt
    }
    license {
      id
      name
    }
    keywords

    ...FilesFragment
  }

  ${FilesFragment}
`;

const queryString = /* GraphQL */ `
  query projectByPath(
    $pathWithNamespace: String!
    $version: String!
    $accessCode: String
  ) {
    project(
      projectPath: $pathWithNamespace
      ref: $version
      accessCode: $accessCode
    ) {
      ...FullProjectFragment
    }
  }

  ${FullProjectFragment}
`;

export const unpreparedProjectByPath = async (
  pathWithNamespace: string,
  version: string,
  accessCode?: string | undefined,
  signal?: AbortSignal,
) => {
  const { project } = await query<
    ProjectByPathQuery,
    ProjectByPathQueryVariables
  >(queryString, { pathWithNamespace, version, accessCode }, signal);

  return project;
};
