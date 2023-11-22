import { navigate } from "hookrouter";
import React, { FC, useEffect } from "react";
import { useModal } from "react-modal-hook";
import { useDispatch } from "react-redux";

import { setProjectWithMeta } from "../../../features/actions";
import { trackEvent } from "../../../features/analytics";
import { preparePartialSimulationProject } from "../../../features/project/utils";
import { Scope, useScopes } from "../../../features/scopes";
import { AppDispatch } from "../../../features/types";
import { addUserProject } from "../../../features/user/slice";
import { forceLogIn } from "../../../features/user/utils";
import { useSafeQueryParams } from "../../../hooks/useSafeQueryParams";
import { urlFromProject } from "../../../routes";
import { useFatalError } from "../../ErrorBoundary/ErrorBoundary";
import { ModalNewProject } from "../../Modal/NewProject/ModalNewProject";
import { useNavigateAway } from "./hooks";
import { createNewSimulationProjectFromTemplate } from "./templates/templates";

export const HashRouterEffectNewProject: FC<{ template?: string }> = ({
  template = "empty",
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const navigateAway = useNavigateAway();
  const [{ namespace }] = useSafeQueryParams();
  const { canNewProject, canNewProjectIfSignedIn } = useScopes(
    Scope.newProject,
    Scope.newProjectIfSignedIn,
  );
  const fatalError = useFatalError();

  const [showModal, hideModal] = useModal(
    () => (
      <ModalNewProject
        onCancel={navigateAway}
        //eslint-disable-next-line @typescript-eslint/require-await
        onSubmit={async (values) => {
          //migration shim

          const project = createNewSimulationProjectFromTemplate(
            values.namespace,
            values.path,
            values.name,
            values.visibility,
            template,
          );

          dispatch(
            trackEvent({
              action: "New Project: Core",
              label: project.pathWithNamespace,
            }),
          );

          dispatch(addUserProject(preparePartialSimulationProject(project)));
          dispatch(setProjectWithMeta(project));
          navigate(urlFromProject(project), false, {}, true);
        }}
        action="Create New Simulation"
        defaultNamespace={namespace}
      />
    ),
    [dispatch, namespace, navigateAway],
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
        "Should never not be able to new project if signed while at /new",
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
