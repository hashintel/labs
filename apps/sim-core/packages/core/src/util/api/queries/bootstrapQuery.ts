import { LocalStorageProject } from "../../../features/project/types";
import { ProjectTypeName, VisibilityLevel } from "../apiTypes";
import type { User } from "../types";
import { getItem } from "../../../hooks/useLocalStorage";
import { preparePartialSimulationProject } from "../../../features/project/utils";
import {
  fetchExampleManifest,
  ExampleManifestEntry,
} from "../../exampleProjects";

export const bootstrapQuery = async () => {
  try {
    const manifest = await fetchExampleManifest();
    const result = bootstrapQueryResponse(manifest);

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

const bootstrapQueryResponse = (manifest: ExampleManifestEntry[]) => {
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
    specialProjects: manifest.map((entry) => ({
      pathWithNamespace: `@example/${entry.slug}`,
      name: entry.name,
      updatedAt: new Date().toISOString(),
      type: (entry.type ?? "Simulation") as ProjectTypeName,
      visibility: "public" as VisibilityLevel,
      forkOf: null,
    })),
  };
};
