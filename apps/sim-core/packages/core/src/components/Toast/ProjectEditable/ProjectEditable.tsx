import React, { FC } from "react";

import { SimulationProject } from "../../../features/project/types";
import { SimulationToast } from "../";
import { ToastAnchor } from "../Anchor";
import { isProjectLatest } from "../../../features/project/utils";
import { urlFromProject } from "../../../routes";
import { useSafeQueryParams } from "../../../hooks/useSafeQueryParams";

export const ToastProjectEditable: FC<{
  project: SimulationProject;
}> = ({ project }) => {
  if (!project.latestRelease || !isProjectLatest(project)) {
    throw new Error(
      "Cannot load ToastProjectEditable for simulation without latest release"
    );
  }

  const [queryParams] = useSafeQueryParams();

  return (
    <SimulationToast theme="info" isDismissable>
      <span>
        You are viewing your editable version of{" "}
        <strong>{project.name.trim()}</strong>. You can edit below and create
        new releases with your changes.
      </span>
      <ToastAnchor
        icon="eye"
        path={urlFromProject({
          pathWithNamespace: project.pathWithNamespace,
          ref: project.latestRelease.tag,
        })}
        query={queryParams}
      >
        OPEN LATEST RELEASE
      </ToastAnchor>
    </SimulationToast>
  );
};
