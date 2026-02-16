import { navigate } from "../../util/navigation";

import { AsyncAppThunk } from "../types";
import { NewProjectModalValues } from "../../components/Modal/NewProject/types";
import { USER_ORG_VALUE } from "../../components/Modal/NewProject/utils";
import { PartialSimulationProject } from "./types";
import { Scope, selectScope } from "../scopes";
import { ToastKind, displayToast } from "../toast";
import { addUserProject } from "../user/slice";
import { getLocalStorageProject, preparePartialSimulationProject } from "./utils";
import { setLocalStorageProject } from "../middleware/localStorage";
import { save } from "../thunks";
import { setProjectWithMeta } from "../actions";
import { trackEvent } from "../analytics";
import { urlFromProject } from "../../routes";

export const forkProject = (
  project: PartialSimulationProject,
  values: NewProjectModalValues
): AsyncAppThunk => async (dispatch, getState) => {
  if (selectScope[Scope.save](getState())) {
    await dispatch(save());
  }

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
    project.ref
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

  dispatch(
    trackEvent({
      action: "Fork Project: Core",
      label: [project.type, project.pathWithNamespace, project.ref].join(" - "),
      context: {
        type: project.type,
        forkPath: nextProject.pathWithNamespace,
      },
    })
  );

  if (effectiveNamespace === "user" && nextProject.type === "Simulation") {
    dispatch(addUserProject(preparePartialSimulationProject(nextProject)));
  }

  dispatch(setProjectWithMeta(nextProject));
  navigate(urlFromProject(nextProject));
  dispatch(displayToast({ kind: ToastKind.ProjectForked, data: project }));
};
