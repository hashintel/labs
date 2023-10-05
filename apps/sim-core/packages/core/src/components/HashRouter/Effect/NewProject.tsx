import React, { FC, useEffect } from "react";
import { useDispatch } from "react-redux";
import { useModal } from "react-modal-hook";
import { navigate } from "hookrouter";

import { AppDispatch } from "../../../features/types";
import { ModalNewProject } from "../../Modal/NewProject/ModalNewProject";
import { Scope, useScopes } from "../../../features/scopes";
import { addUserProject } from "../../../features/user/slice";
import { createNewSimulationProject } from "../../../util/api/queries/createNewSimulationProject";
import { forceLogIn } from "../../../features/user/utils";
import { preparePartialSimulationProject } from "../../../features/project/utils";
import { setProjectWithMeta } from "../../../features/actions";
import { templates } from "./templates/templates";
import { trackEvent } from "../../../features/analytics";
import { urlFromProject } from "../../../routes";
import { useFatalError } from "../../ErrorBoundary/ErrorBoundary";
import { useNavigateAway } from "./hooks";
import { useSafeQueryParams } from "../../../hooks/useSafeQueryParams";

export const HashRouterEffectNewProject: FC<{ template?: string }> = ({
  template = "empty",
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const navigateAway = useNavigateAway();
  const [{ namespace }] = useSafeQueryParams();
  const { canNewProject, canNewProjectIfSignedIn } = useScopes(
    Scope.newProject,
    Scope.newProjectIfSignedIn
  );
  const fatalError = useFatalError();

  const actions = templates[template];
  if (!actions) {
    throw new Error(`Unrecognised template ${template}`);
  }

  const [showModal, hideModal] = useModal(
    () => (
      <ModalNewProject
        onCancel={navigateAway}
        onSubmit={async (values) => {
          const project = await createNewSimulationProject(
            values.namespace,
            values.path,
            values.name,
            values.visibility,
            actions
          );

          dispatch(
            trackEvent({
              action: "New Project: Core",
              label: project.pathWithNamespace,
            })
          );

          if (!values.namespace) {
            dispatch(addUserProject(preparePartialSimulationProject(project)));
          }

          dispatch(setProjectWithMeta(project));
          navigate(urlFromProject(project), false, {}, true);
        }}
        action="Create New Simulation"
        defaultNamespace={namespace}
      />
    ),
    [actions, dispatch, namespace, navigateAway]
  );

  useEffect(() => {
    if (canNewProject) {
      showModal();

      return () => {
        hideModal();
      };
    } else if (canNewProjectIfSignedIn) {
      forceLogIn(true);
    } else {
      fatalError(
        "Should never not be able to new project if signed while at /new"
      );
    }
  }, [
    dispatch,
    showModal,
    hideModal,
    canNewProject,
    canNewProjectIfSignedIn,
    fatalError,
  ]);

  return null;
};
