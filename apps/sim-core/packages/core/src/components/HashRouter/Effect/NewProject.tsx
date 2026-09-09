import React, { FC, useEffect } from "react";
import { useModal } from "react-modal-hook";
import { navigate } from "../../../util/navigation";

import { ModalNewProject } from "../../Modal/NewProject/ModalNewProject";
import { createLocalProjectFromTemplate } from "../../../util/api/queries/createLocalProjectFromTemplate";
import { preparePartialSimulationProject } from "../../../features/project/utils";
import { templates } from "./templates/templates";

import { urlFromProject } from "../../../routes";
import { useNavigateAway } from "./hooks";
import { useSafeQueryParams } from "../../../hooks/useSafeQueryParams";
import { useUser } from "../../../features/user/UserContext";
import { useProject } from "../../../features/project/ProjectContext";

export const HashRouterEffectNewProject: FC<{ template?: string }> = ({
  template = "empty",
}) => {
  const { addUserProject } = useUser();
  const { setProjectWithMeta } = useProject();
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
            actions,
          );

          if (!values.namespace) {
            addUserProject(preparePartialSimulationProject(project));
          }

          setProjectWithMeta(project);
          navigate(urlFromProject(project), false, {}, true);
        }}
        action="Create New Simulation"
        defaultNamespace={namespace}
      />
    ),
    [actions, addUserProject, setProjectWithMeta, namespace, navigateAway],
  );

  useEffect(() => {
    showModal();
    return () => hideModal();
  }, [showModal, hideModal]);

  return null;
};
