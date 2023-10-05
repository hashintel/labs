import { navigate } from "hookrouter";

import { AsyncAppThunk } from "../types";
import { NewProjectModalValues } from "../../components/Modal/NewProject/types";
import { PartialSimulationProject } from "./types";
import { Scope, selectScope } from "../scopes";
import { ToastKind, displayToast } from "../toast";
import { addUserProject } from "../user/slice";
import { forkProjectQuery } from "../../util/api/queries/forkProjectQuery";
import { preparePartialSimulationProject } from "./utils";
import { save } from "../thunks";
import { selectFileActions } from "../files/selectors";
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

  const state = getState();
  const actions = selectFileActions(state);

  const nextProject = await forkProjectQuery(
    project.pathWithNamespace,
    project.ref,
    values.name,
    values.namespace,
    values.path,
    values.visibility,
    actions
  );

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

  if (!values.namespace && nextProject.type === "Simulation") {
    dispatch(addUserProject(preparePartialSimulationProject(nextProject)));
  }

  dispatch(setProjectWithMeta(nextProject));
  navigate(urlFromProject(nextProject));
  dispatch(displayToast({ kind: ToastKind.ProjectForked, data: project }));
};
