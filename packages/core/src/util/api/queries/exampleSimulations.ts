import { PartialProjectFragment } from "./partialProjectByPath";
import {
  PartialSimulationProject,
  UnpreparedPartialSimulationProject,
} from "../../../features/project/types";
import { preparePartialSimulationProject } from "../../../features/project/utils";
import { query } from "../query";

/**
 * @todo specialProjects needs to be sortable
 */
export const ExampleProjectsFragment = /* GraphQL */ `
  fragment ExampleProjectsFragment on Query {
    specialProjects(type: Example) {
      ...PartialProjectFragment
    }
  }
`;

export const prepareExamples = (
  examples: UnpreparedPartialSimulationProject[],
) => examples.map(preparePartialSimulationProject);

export const exampleSimulations = async (): Promise<
  PartialSimulationProject[]
> => {
  const examples = (
    await query<{
      specialProjects: UnpreparedPartialSimulationProject[];
    }>(
      `
        query exampleSimulations {
          ...ExampleProjectsFragment
        }
        
        ${PartialProjectFragment}
        ${ExampleProjectsFragment}
      `,
    )
  ).specialProjects;

  return prepareExamples(examples);
};
