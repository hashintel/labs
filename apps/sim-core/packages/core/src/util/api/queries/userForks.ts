import { query } from "../query";

export const userForks = async (
  pathWithNamespace: string,
  accessCode?: string,
  signal?: AbortSignal,
) =>
  (
    await query<{ project: { userForkPaths: string[] } }>(
      `
          query userForks($pathWithNamespace: String!, $accessCode: String) {
              project(projectPath: $pathWithNamespace, accessCode: $accessCode) {
                  userForkPaths
              }
          }
        `,
      { pathWithNamespace, accessCode },
      signal,
    )
  ).project.userForkPaths;
