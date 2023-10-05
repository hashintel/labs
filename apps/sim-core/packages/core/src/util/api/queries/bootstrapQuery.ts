import { LocalStorageProject } from "../../../features/project/types";
import { ProjectTypeName, VisibilityLevel } from "../auto-types";
import type { User } from "../types";
import { getItem } from "../../../hooks/useLocalStorage";
import { identifyBasicUser } from "./basicUser";
import { prepareExamples } from "./exampleSimulations";
import { prepareUserProjects } from "./myProjects";

// const queryString = /* GraphQL */ `
//   query bootstrap {
//     me {
//       ...BasicUserFragment
//       image
//       tourProgress {
//         completed
//         version
//         lastStepViewed
//       }
//       memberOf {
//         org {
//           id
//           name
//           shortname
//         }
//         role {
//           id
//           name
//         }
//       }
//       role {
//         id
//         name
//       }

//       ...UserProjectsFragment
//     }

//     ...ExampleProjectsFragment
//   }

//   ${BasicUserFragment}
//   ${PartialProjectFragment}
//   ${UserProjectsFragment}
//   ${ExampleProjectsFragment}
// `;

export const bootstrapQuery = async () => {
  let me: User | undefined;

  try {
    // const result = await query<BootstrapQuery>(queryString);
    // Migration shim
    const result = bootstrapQueryResponse;

    const examples = prepareExamples(result.specialProjects);
    const bootstrap = { examples };

    if (result.me) {
      const { projects, ...user } = result.me as typeof result.me & {
        email: string;
        role: Pick<User, "role">;
      };
      me = user;

      return {
        ...bootstrap,
        user,
        projects: prepareUserProjects(projects.results),
      };
    } else {
      return bootstrap;
    }
  } catch {
    // Migration shim
    return { examples: [] };
  } finally {
    identifyBasicUser(me);
  }
};

// 'my projects' in localstorage:
const localStorageProjects = [];
for (const key in localStorage) {
  if (!localStorage.hasOwnProperty(key) || !key.startsWith(`project/`)) {
    continue;
  }

  const project = getItem<LocalStorageProject>(key);
  if (project) {
    localStorageProjects.push({
      pathWithNamespace: project.pathWithNamespace,
      name: project.name,
      updatedAt: project.updatedAt,
      type: project.type,
      visibility: project.visibility,
      latestRelease: project.latestRelease,
      forkOf: project.forkOf,
    });
  }
}

const bootstrapQueryResponse = {
  // migration shim
  me: {
    id: "5d24ba78dc27ed00b3137d91",
    email: "user@hash.ai",
    fullName: "User",
    shortname: "user",
    staffMember: false,
    image:
      "https://s3.amazonaws.com/cdn-us1.hash.ai/assets/avatars/user-default.svg",
    tourProgress: {
      completed: true,
      version: "1.1",
      lastStepViewed: "done",
    },
    memberOf: [],
    role: {
      id: "5d24ba74dc27ed00b3137d81",
      name: "User",
    },
    projects: {
      results: localStorageProjects,
    },
  },
  specialProjects: [
    {
      pathWithNamespace: "@hash/wildfires-regrowth",
      name: "Wildfires - Regrowth",
      updatedAt: "2022-05-19T13:57:26.000Z",
      type: ProjectTypeName.Simulation,
      visibility: VisibilityLevel.Public,
      latestRelease: {
        createdAt: "2022-02-18T15:53:24.422Z",
        tag: "9.9.0",
      },
      forkOf: null,
    },
    {
      pathWithNamespace: "@hash/boids-3d",
      name: "Boids 3D",
      updatedAt: "2022-03-30T04:30:47.170Z",
      type: ProjectTypeName.Simulation,
      visibility: VisibilityLevel.Public,
      latestRelease: {
        createdAt: "2022-03-30T04:30:47.170Z",
        tag: "6.3.0",
      },
      forkOf: null,
    },
    {
      pathWithNamespace: "@hash/rainfall",
      name: "Rainfall",
      updatedAt: "2022-04-04T15:42:31.315Z",
      type: ProjectTypeName.Simulation,
      visibility: VisibilityLevel.Public,
      latestRelease: {
        createdAt: "2022-04-04T15:42:31.315Z",
        tag: "7.3.0",
      },
      forkOf: null,
    },
    {
      pathWithNamespace: "@hash/sugarscape",
      name: "Sugarscape",
      updatedAt: "2022-04-04T16:41:39.902Z",
      type: ProjectTypeName.Simulation,
      visibility: VisibilityLevel.Public,
      latestRelease: {
        createdAt: "2022-04-04T16:41:39.902Z",
        tag: "7.6.0",
      },
      forkOf: null,
    },
    {
      pathWithNamespace: "@hash/ant-foraging",
      name: "Ant Foraging",
      updatedAt: "2022-09-28T15:56:47.000Z",
      type: ProjectTypeName.Simulation,
      visibility: VisibilityLevel.Public,
      latestRelease: {
        createdAt: "2022-04-04T16:54:15.820Z",
        tag: "7.5.0",
      },
      forkOf: null,
    },
    {
      pathWithNamespace: "@hash/model-market",
      name: "Model Market",
      updatedAt: "2021-10-28T16:08:40.348Z",
      type: ProjectTypeName.Simulation,
      visibility: VisibilityLevel.Public,
      latestRelease: {
        createdAt: "2021-10-28T16:08:40.348Z",
        tag: "4.5.2",
      },
      forkOf: null,
    },
    {
      pathWithNamespace: "@hash/virus-mutation-and-drug-resistance",
      name: "Virus - Mutation and Drug Resistance",
      updatedAt: "2022-04-05T20:31:30.366Z",
      type: ProjectTypeName.Simulation,
      visibility: VisibilityLevel.Public,
      latestRelease: {
        createdAt: "2022-04-05T20:31:30.366Z",
        tag: "3.6.0",
      },
      forkOf: null,
    },
    {
      pathWithNamespace: "@hash/city-infection-model",
      name: "City Infection Model",
      updatedAt: "2022-05-11T11:51:41.000Z",
      type: ProjectTypeName.Simulation,
      visibility: VisibilityLevel.Public,
      latestRelease: {
        createdAt: "2022-04-05T18:05:35.026Z",
        tag: "6.5.0",
      },
      forkOf: null,
    },
    {
      pathWithNamespace: "@hash/rumor-mill-public-health-practices",
      name: "Rumor Mill - Public Health Practices",
      updatedAt: "2022-04-05T14:28:45.000Z",
      type: ProjectTypeName.Simulation,
      visibility: VisibilityLevel.Public,
      latestRelease: {
        createdAt: "2021-02-17T15:53:34.378Z",
        tag: "2.2.3",
      },
      forkOf: null,
    },
    {
      pathWithNamespace: "@hash/warehouse-logistics",
      name: "Warehouse Logistics",
      updatedAt: "2022-04-04T15:45:40.862Z",
      type: ProjectTypeName.Simulation,
      visibility: VisibilityLevel.Public,
      latestRelease: {
        createdAt: "2022-04-04T15:45:40.862Z",
        tag: "2.7.0",
      },
      forkOf: null,
    },
    {
      pathWithNamespace: "@hash/published-display-behaviors",
      name: "Published Display Behaviors",
      updatedAt: "2021-12-01T17:57:43.000Z",
      type: ProjectTypeName.Simulation,
      visibility: VisibilityLevel.Public,
      latestRelease: {
        createdAt: "2021-03-08T16:58:43.188Z",
        tag: "2.3.0",
      },
      forkOf: null,
    },
    {
      pathWithNamespace: "@hash/connection-example",
      name: "Connection Example",
      updatedAt: "2021-03-03T15:56:04.564Z",
      type: ProjectTypeName.Simulation,
      visibility: VisibilityLevel.Public,
      latestRelease: {
        createdAt: "2021-03-03T15:56:04.564Z",
        tag: "1.1.1",
      },
      forkOf: null,
    },
  ],
};
