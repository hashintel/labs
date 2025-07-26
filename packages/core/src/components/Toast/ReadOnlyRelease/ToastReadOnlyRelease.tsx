import React, { FC } from "react";

import { SimulationProject } from "../../../features/project/types";
import { SimulationToast } from "../";
import { ToastAnchor } from "../Anchor";
import {
  isProjectLatest,
  refIsNotCommit,
} from "../../../features/project/utils";
import { mainProjectPath } from "../../../routes";

export const ToastReadOnlyRelease: FC<{
  project: SimulationProject;
}> = ({ project }) => {
  if (isProjectLatest(project)) {
    throw new Error(
      "Cannot load ToastReadOnlyRelease for latest copy of a project",
    );
  }

  const isNotCommit = refIsNotCommit(project.ref);

  return (
    <SimulationToast theme="info" isDismissable>
      <span>
        You are viewing a{" "}
        {isNotCommit ? <>released copy</> : <>previous commit</>} of{" "}
        <strong>{project.name.trim()}</strong>. You cannot edit this version.
      </span>
      <ToastAnchor
        icon="pencil"
        path={mainProjectPath(project.pathWithNamespace)}
        query={project.access ? { accessCode: project.access.code } : {}}
      >
        OPEN WORKING COPY
      </ToastAnchor>
    </SimulationToast>
  );
};
