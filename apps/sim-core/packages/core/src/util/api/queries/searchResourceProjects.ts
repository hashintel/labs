import { ReleaseFile, ResourceProject } from "../../../features/project/types";
import { query } from "../query";
import { releaseToHcFiles } from "../../../features/files/utils";

export const searchResourceProjects = async (
  searchTerm: string,
  signal?: AbortSignal
): Promise<ResourceProject[]> =>
  (
    await query<{
      searchProjects: {
        results: (Omit<ResourceProject, "files"> & {
          latestRelease: { files: ReleaseFile[] };
          owner: {
            shortname: string;
          };
        })[];
      };
    }>(
      `
        query SearchProjects($searchTerm: String) {
          searchProjects(
            query: $searchTerm,
            types: [Dataset, Behavior],
            sort: relevance,
            releasedOnly: true
          ) {
            results {
              ... on Project {
                id
                name
                description
                createdAt
                updatedAt
                pathWithNamespace
                type
                canUserEdit
                trusted
                visibility
                latestRelease {
                  tag
                  createdAt
                  files {
                    name
                    path
                    dependencyPath
                    contents
                    ref
                  }
                }
                owner {
                  ... on User { name: fullName, shortname }
                  ... on Org { name, shortname }
                }
                subject { name }
              }
            }
          }
        }
      `,
      { searchTerm },
      signal
    )
  ).searchProjects.results.map((project) => ({
    ...project,
    files: releaseToHcFiles({
      files: project.latestRelease.files,
      canUserEdit: project.canUserEdit,
      latestReleaseTag: project.latestRelease.tag,
      pathWithNamespace: project.pathWithNamespace,
      tag: project.latestRelease.tag,
      visibility: project.visibility,
    }),
  }));
