import type { DependenciesDescriptor } from "../../../features/files/types";
import { Release } from "../../../features/project/types";
import { graphqlUuid } from "../utils";
import { query } from "../query";

type DepArgs = {
  pathWithNamespace: string;
  tag: string;
  files: string[];
};

export async function fetchDependencies(
  dependencies: DependenciesDescriptor,
  signal?: AbortSignal
): Promise<Release[]> {
  /**
   * DependenciesDescriptor is a full file path -> version record, but the API
   * groups files per project, so we need to group our descriptor per project
   * too.
   */
  const groupedDependencies = Object.values(
    Object.entries(dependencies).reduce<Record<string, DepArgs>>(
      (grouped, [path, tag]) => {
        const parts = path.split("/");
        const file = parts[parts.length - 1];

        /**
         * There's a legacy format where behaviors only have two parts, as
         * behavior listings were previously guaranteed to be single file only
         * listings. This is now no longer the case.
         *
         * @todo remove this legacy support
         */
        const pathWithNamespace =
          parts.length === 2 ? path : parts.slice(0, 2).join("/");

        const projectUrl = `${pathWithNamespace}/${tag}`;

        grouped[projectUrl] = grouped[projectUrl] ?? {
          pathWithNamespace,
          tag,
          files: [],
        };

        grouped[projectUrl].files.push(file);

        return grouped;
      },
      {}
    )
  );

  const res = await query<{
    [uuid: string]: Release | null;
  }>(
    `
    query fetchDependencies {
      ${groupedDependencies.reduce(
        (query, { pathWithNamespace, tag, files }) => `${query}
        ${graphqlUuid()}: release(projectPath: "${pathWithNamespace}", tag: "${tag}", files: ${JSON.stringify(
          files
        )}) {
          ...dependencyFields
        }
      `,
        ""
      )}
    }
    
    fragment dependencyFields on Release {
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
  `,
    signal
  );

  return Object.values(res).filter(
    (release): release is Release => release !== null
  );
}
