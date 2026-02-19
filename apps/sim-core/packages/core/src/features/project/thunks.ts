import { navigate } from "../../util/navigation";

import { NewProjectModalValues } from "../../components/Modal/NewProject/types";
import { USER_ORG_VALUE } from "../../components/Modal/NewProject/utils";
import { PartialSimulationProject } from "./types";
import { ToastKind } from "../toast/enums";
import { getLocalStorageProject, preparePartialSimulationProject } from "./utils";
import { setLocalStorageProject } from "../middleware/localStorage";
import { trackEvent } from "../analytics";
import { urlFromProject } from "../../routes";

/**
 * Fork a project: create a copy in local storage and set it as active.
 * Returns an object with callbacks that the UI layer needs to invoke on
 * the relevant contexts.
 */
export function prepareForkProject(
  project: PartialSimulationProject,
  values: NewProjectModalValues,
) {
  const effectiveNamespace =
    !values.namespace || values.namespace === USER_ORG_VALUE
      ? "user"
      : values.namespace;
  const pathWithNamespace =
    effectiveNamespace === "user"
      ? values.path
      : `@${effectiveNamespace}/${values.path}`;
  const now = new Date().toISOString();

  const sourceProject = getLocalStorageProject(
    project.pathWithNamespace,
    project.ref,
  );
  if (!sourceProject) {
    throw new Error("Cannot fork: project not found in local storage");
  }

  const nextProject = {
    ...sourceProject,
    id: pathWithNamespace,
    name: values.name,
    pathWithNamespace,
    namespace: values.namespace,
    visibility: values.visibility,
    createdAt: now,
    updatedAt: now,
    forkOf: { pathWithNamespace: project.pathWithNamespace },
    actions: [],
  };

  setLocalStorageProject(nextProject);

  trackEvent({
    action: "Fork Project: Core",
    label: [project.type, project.pathWithNamespace, project.ref].join(" - "),
    context: {
      type: project.type,
      forkPath: nextProject.pathWithNamespace,
    },
  });

  return {
    nextProject,
    partialProject:
      effectiveNamespace === "user" && nextProject.type === "Simulation"
        ? preparePartialSimulationProject(nextProject)
        : null,
    toastData: { kind: ToastKind.ProjectForked, data: project },
  };
}
