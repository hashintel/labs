import React, { FC, useEffect } from "react";
import { useDispatch } from "react-redux";
import { useModal } from "react-modal-hook";
import { navigate } from "../../../util/navigation";

import { AppDispatch } from "../../../features/types";
import { ModalNewProject } from "../../Modal/NewProject/ModalNewProject";
import { createLocalProjectFromTemplate } from "../../../util/api/queries/createLocalProjectFromTemplate";
import { preparePartialSimulationProject } from "../../../features/project/utils";
import { setProjectWithMeta } from "../../../features/actions";
import { templates } from "./templates/templates";
import { trackEvent } from "../../../features/analytics";
import { urlFromProject } from "../../../routes";
import { useNavigateAway } from "./hooks";
import { useSafeQueryParams } from "../../../hooks/useSafeQueryParams";
import { useUser } from "../../../features/user/UserContext";

export const HashRouterEffectNewProject: FC<{ template?: string }> = ({
  template = "empty",
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const { addUserProject } = useUser();
  const navigateAway = useNavigateAway();
  const [{ namespace }] = useSafeQueryParams();

  const actions = templates[template];
  if (!actions) {
    throw new Error(`Unrecognised template ${template}`);
  }

  const [showModal, hideModal] = useModal(
    () => (
      <ModalNewProject
        onCancel={navigateAway}
        onSubmit={async (values) => {
          const project = createLocalProjectFromTemplate(
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
            addUserProject(preparePartialSimulationProject(project));
          }

          dispatch(setProjectWithMeta(project));
          navigate(urlFromProject(project), false, {}, true);
        }}
        action="Create New Simulation"
        defaultNamespace={namespace}
      />
    ),
    [actions, addUserProject, dispatch, namespace, navigateAway]
  );

  useEffect(() => {
    showModal();
    return () => hideModal();
  }, [showModal, hideModal]);

  return null;
};
