import { query } from "../query";

export const createDatasetQuery = async (
  projectPath: string,
  filename: string,
  datasetName: string,
) => {
  const { dataset, postForm } = (
    await query<{
      addDataset: {
        postForm?: {
          url: string;
          fields?: Record<string | number, string> & { key: string };
        };
        dataset?: {
          id: string;
          filename: string;
          name: string;
        };
      };
    }>(
      `
      mutation addDataset(
        $name: String!
        $filename: String!
        $projectPath: String!
      ) {
        addDataset(
          data: { name: $name, filename: $filename, projectPath: $projectPath }
        ) {
          dataset {
            id
            filename
            name
          }
          postForm {
            url
            fields
          }
        }
      }
    `,
      {
        projectPath: projectPath,
        filename: filename,
        name: datasetName,
      },
    )
  ).addDataset;

  if (!postForm || !dataset) {
    throw new Error("Failed to create dataset");
  }

  return { dataset, postForm };
};
