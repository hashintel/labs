import { FilesFragment } from "./unpreparedProjectByPath";
import { ForkAndReleaseBehaviorsMutation } from "../auto-types";
import { ProjectVisibility } from "../../../features/project/types";
import { query } from "../query";
import { toHcFiles } from "../../../features/files/utils";

const queryString = /* GraphQL */ `
  mutation forkAndReleaseBehaviors(
    $projectPath: String!
    $name: String!
    $namespace: String
    $path: String!
    $commitMessage: String!
    $tag: String!
    $releaseDescription: String!
    $files: [ExportedFile!]!
    $projectDescription: String!
    $visibility: VisibilityLevel!
    $license: String!
    $keywords: [String!]! # $subjects: [SchemaReferenceInput!]!
  ) {
    forkAndReleaseBehavior(
      projectPath: $projectPath
      name: $name
      namespace: $namespace
      path: $path

      commitMessage: $commitMessage
      tag: $tag
      description: $releaseDescription

      update: {
        files: $files
        description: $projectDescription
        visibility: $visibility
        license: $license
        keywords: $keywords
        # subject: $subjects
      }
    ) {
      sourceProject {
        updatedAt

        ...FilesFragment
      }
      behaviorProject {
        pathWithNamespace
        ref
      }
    }
  }

  ${FilesFragment}
`;

export const forkAndReleaseBehaviorsQuery = async (args: {
  projectPath: string;
  name: string;
  namespace: string;
  path: string;
  files: { filename: string; path: string }[];
  projectDescription: string;
  visibility: ProjectVisibility;
  license: string;
  keywords: string[];
  // subjects: string[];
}) => {
  const fork = (
    await query<ForkAndReleaseBehaviorsMutation>(queryString, {
      ...args,
      tag: "1.0.0",
      commitMessage: "Release: Initial Release (1.0.0)",
      releaseDescription: "Initial Release",
    })
  ).forkAndReleaseBehavior;

  return {
    updatedAt: fork.sourceProject.updatedAt,
    files: toHcFiles(fork.sourceProject),
    behaviorPathWithNamespace: fork.behaviorProject.pathWithNamespace,
    behaviorRef: fork.behaviorProject.ref,
  };
};
