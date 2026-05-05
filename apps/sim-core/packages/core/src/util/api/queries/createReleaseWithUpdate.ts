import {
  ProjectUpdate,
  SimulationProject,
} from "../../../features/project/types";
import { query } from "../query";

const queryString = `
  mutation createReleaseWithUpdate(
    $projectPath: String!,
    $commitMessage: String!,
    $updateDescription: String!,
    $tag: String!,
    $update: ProjectUpdate!
  ) {
    updateAndRelease(
      projectPath: $projectPath,
      commitMessage: $commitMessage,
      description: $updateDescription,
      tag: $tag,
      update: $update
    ) {
      project {
        name
        description
        keywords
        license { id, name }
        updatedAt
        latestRelease { tag, createdAt } 
      }
    }
  }
`;

export const createReleaseWithUpdate = async (
  projectPath: string,
  tag: string,
  updateDescription: string,
  update: ProjectUpdate,
) =>
  (
    await query<{
      updateAndRelease: {
        project: Pick<
          SimulationProject,
          | "name"
          | "description"
          | "keywords"
          | "license"
          | "updatedAt"
          | "latestRelease"
        >;
      };
    }>(queryString, {
      commitMessage: `Release: ${updateDescription} (${tag})`,
      updateDescription,
      projectPath,
      name,
      tag,
      update,
    })
  ).updateAndRelease.project;
