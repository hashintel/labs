import { PartialProjectFragment } from "./partialProjectByPath";
import {
  PartialSimulationProject,
  UnpreparedPartialSimulationProject,
} from "../../../features/project/types";
import { preparePartialSimulationProject } from "../../../features/project/utils";
import { query } from "../query";

type MyProjects = {
  me: {
    projects: {
      results: UnpreparedPartialSimulationProject[];
    };
  };
};

export const UserProjectsFragment = /* GraphQL */ `
  fragment UserProjectsFragment on User {
    projects(types: [Simulation, Behavior], sort: updatedAt) {
      results {
        ...PartialProjectFragment
      }
    }
  }
`;

const queryString = /* GraphQL */ `
  query myProjects {
    me {
      ...UserProjectsFragment
    }
  }

  ${PartialProjectFragment}
  ${UserProjectsFragment}
`;

export const prepareUserProjects = (
  projects: UnpreparedPartialSimulationProject[]
) => projects.map(preparePartialSimulationProject);

export const myProjects = async (): Promise<PartialSimulationProject[]> =>
  prepareUserProjects(
    (await query<MyProjects>(queryString)).me.projects.results
  );
