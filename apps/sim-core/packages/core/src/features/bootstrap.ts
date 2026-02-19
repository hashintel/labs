import { bootstrapQuery } from "../util/api/queries";
import { getReleaseMeta } from "../util/api";

interface BootstrapCallbacks {
  bootstrapUser: (payload: {
    user?: any;
    tourProgress: any;
    projects?: any[];
  }) => void;
  setExamples: (examples: any[]) => void;
  setToastForProject: (
    project: any,
    canEdit: boolean,
    canWriteProject: boolean,
    fromLegacy?: boolean,
  ) => void;
  currentProject: any;
}

export async function runBootstrap(callbacks: BootstrapCallbacks) {
  getReleaseMeta().catch(() => {
    console.warn(
      "Failed to get release meta at bootstrap time -- must retry later",
    );
  });

  const result = await bootstrapQuery();

  const tourProgress =
    "user" in result ? result.user?.tourProgress ?? null : null;

  callbacks.bootstrapUser({
    user: "user" in result ? result.user : undefined,
    tourProgress,
    projects: "projects" in result ? result.projects : undefined,
  });

  callbacks.setExamples(result.examples);

  if (callbacks.currentProject) {
    callbacks.setToastForProject(
      callbacks.currentProject,
      true,
      callbacks.currentProject.canUserEdit,
    );
  }
}
