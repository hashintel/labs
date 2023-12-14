import { ReleaseDescription } from "../../../features/project/types";
import { query } from "../query";

export const projectReleaseTags = async (
  pathWithNamespace: string,
  ref: string | undefined | null,
  accessCode?: string,
  signal?: AbortSignal,
) =>
  (
    await query<{
      project: { releases: Pick<ReleaseDescription, "tag">[] };
    }>(
      `
            query projectReleases($pathWithNamespace: String!, $ref: String!, $accessCode: String) {
              project(projectPath: $pathWithNamespace, ref: $ref, accessCode: $accessCode) {
                releases { tag }
              }
            }
         `,
      { pathWithNamespace, ref, accessCode },
      signal,
    )
  ).project.releases.map((release) => release.tag);
