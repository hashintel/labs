import { BUILTIN_SIMULATIONS } from "../../builtinSimulations";
import { LocalStorageProject } from "../../../features/project/types";
import { ProjectTypeName, VisibilityLevel } from "../apiTypes";
import type { User } from "../types";
import { getItem } from "../../../hooks/useLocalStorage";
import {
  getLocalStorageProject,
  preparePartialSimulationProject,
} from "../../../features/project/utils";
import { setLocalStorageProject } from "../../../features/middleware/localStorage";

export const bootstrapQuery = async () => {
  try {
    const result = bootstrapQueryResponse();

    const examples = result.specialProjects.map(
      preparePartialSimulationProject,
    );
    const bootstrap = { examples };

    if (result.me) {
      const { projects, ...user } = result.me as typeof result.me & {
        email: string;
        role: Pick<User, "role">;
      };

      return {
        ...bootstrap,
        user,
        projects: projects.results.map(preparePartialSimulationProject),
      };
    } else {
      return bootstrap;
    }
  } catch {
    return { examples: [] };
  }
};

const bootstrapQueryResponse = () => {
  for (const simulation of BUILTIN_SIMULATIONS) {
    const existingProject = getLocalStorageProject(
      simulation.pathWithNamespace,
      simulation.ref,
    );
    if (!existingProject) {
      setLocalStorageProject({ ...simulation, actions: [] });
    }
  }

  const myProjects = [];
  for (const key in localStorage) {
    if (
      !localStorage.hasOwnProperty(key) ||
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
        pathWithNamespace: "@hash/wildfires-regrowth",
        name: "Wildfires - Regrowth",
        updatedAt: "2022-05-19T13:57:26.000Z",
        type: ProjectTypeName.Simulation,
        visibility: VisibilityLevel.Public,
        forkOf: null,
      },
    ],
  };
};
