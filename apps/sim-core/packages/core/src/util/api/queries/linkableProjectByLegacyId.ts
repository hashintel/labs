import {
  LinkableProject,
  SimulationProject,
} from "../../../features/project/types";
import { query } from "../query";

type LegacyProject = Pick<
  SimulationProject,
  "pathWithNamespace" | "latestRelease"
>;

export const linkableProjectByLegacyId = async (
  id: string,
  signal?: AbortSignal
): Promise<LinkableProject> => {
  const { pathWithNamespace, latestRelease } = (
    await query<{
      project: LegacyProject;
    }>(
      `
        query simulationById($id: ID!) {
          project(oldId: $id, oldType: Simulation) {
            pathWithNamespace
            latestRelease { tag }
          }
        }
      `,
      { id },
      signal
    )
  ).project;

  return {
    pathWithNamespace: pathWithNamespace,
    ref: latestRelease?.tag,
  };
};
