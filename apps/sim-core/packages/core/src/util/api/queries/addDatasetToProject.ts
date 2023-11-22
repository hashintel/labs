import {
  AddDatasetToProjectMutation,
  AddDatasetToProjectMutationVariables,
} from "../auto-types";
import { query } from "../query";

const queryString = /* GraphQL */ `
  mutation addDatasetToProject(
    $id: ID!
    $projectPath: String!
    $csv: Boolean!
  ) {
    addDatasetToProject(
      id: $id
      projectPath: $projectPath
      rawCsv: $csv
      exported: false
    ) {
      id
      files {
        contents
        name
        path
      }
    }
  }
`;

export const addDatasetToProject = async (
  projectPath: string,
  datasetId: string,
  datasetS3Key: string | undefined,
  rawCsv: boolean,
) => {
  const { files } = (
    await query<
      AddDatasetToProjectMutation,
      AddDatasetToProjectMutationVariables
    >(queryString, {
      id: datasetId,
      projectPath: projectPath,
      csv: rawCsv,
    })
  ).addDatasetToProject;

  // @todo this will break when we can put files anywhere
  const datasets = files
    .filter((file) => file.path.startsWith("data/"))
    .map((file) => ({ file, data: JSON.parse(file.contents) }));

  return datasets.find((dataset) => dataset.data.s3Key === datasetS3Key);
};
