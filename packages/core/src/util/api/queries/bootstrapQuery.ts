import { BUILTIN_SIMULATIONS } from "../../builtinSimulations";
import { LocalStorageProject } from "../../../features/project/types";
import { ProjectTypeName, VisibilityLevel } from "../types";
import type { User } from "../types";
import { getItem } from "../../../hooks/useLocalStorage";
import { getLocalStorageProject } from "../../../features/project/utils";
import { prepareExamples } from "./exampleSimulations";
import { prepareUserProjects } from "./myProjects";
import { setLocalStorageProject } from "../../../features/middleware/localStorage";

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

//eslint-disable-next-line @typescript-eslint/require-await
export const bootstrapQuery = async () => {
  try {
    // const result = await query<BootstrapQuery>(queryString);
    // Migration shim
    const result = bootstrapQueryResponse();

    const examples = prepareExamples(result.specialProjects);
    const bootstrap = { examples };

    if (result.me) {
      const { projects, ...user } = result.me as typeof result.me & {
        email: string;
        role: Pick<User, "role">;
      };

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
  }
};

const bootstrapQueryResponse = () => {
  // Migration shim-- load our BUILTIN_SIMULATIONS into localstorage so we have a default 'my project'
  for (const simulation of BUILTIN_SIMULATIONS) {
    const existingProject = getLocalStorageProject(
      simulation.pathWithNamespace,
      simulation.ref,
    );
    if (!existingProject) {
      setLocalStorageProject({ ...simulation, actions: [] });
    }
  }

  // Base the 'my projects' set off of what's in localstorage
  const myProjects = [];
  for (const key in localStorage) {
    if (
      !Object.prototype.hasOwnProperty.call(localStorage, key) ||
      !key.startsWith(`project/`) ||
      !key.endsWith("/main")
    ) {
      continue;
    }
    const project = getItem<LocalStorageProject>(key);
    if (project) {
      myProjects.push({
        pathWithNamespace: project.pathWithNamespace,
        name: project.name,
        updatedAt: project.updatedAt,
        type: project.type,
        visibility: project.visibility,
        latestRelease: project.latestRelease,
        forkOf: project.forkOf,
        ref: project.ref,
      });
    }
  }

  return {
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
        results: myProjects,
      },
    },
    specialProjects: [
      {
        // Migration shim--
        // HASH will select the top item in this list as the default simulation.
        // Keep this present to align with our `BUILTIN_SIMULATIONS`.
        pathWithNamespace: "@imported/consensus-algorithms",
        name: "Wildfires - Regrowth",
        updatedAt: "2022-05-19T13:57:26.000Z",
        type: ProjectTypeName.Simulation,
        visibility: VisibilityLevel.Public,
        // latestRelease: {
        //   createdAt: "2022-02-18T15:53:24.422Z",
        //   tag: "9.9.0",
        // },
        forkOf: null,
      },
    ],
  };
};
