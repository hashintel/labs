import React, { FC } from "react";

import { SimulationProject } from "../../../features/project/types";
import { SimulationToast } from "../SimulationToast";
import { ToastAnchor } from "../Anchor";
import { urlFromProject } from "../../../routes";
import { useSafeQueryParams } from "../../../hooks/useSafeQueryParams";

interface ToastPublishSuccessProps {
  project: Pick<SimulationProject, "name" | "pathWithNamespace"> & {
    latestRelease?: Pick<
      NonNullable<SimulationProject["latestRelease"]>,
      "tag"
    > | null;
  };
}

export const ToastReleaseSuccess: FC<ToastPublishSuccessProps> = ({
  project,
}) => {
  if (!project.latestRelease) {
    throw new Error(
      "Cannot show release success toast for project that has no release",
    );
  }

  const [queryParams] = useSafeQueryParams();

  return (
    <SimulationToast theme="success" isDismissable>
      <span>
        You have successfully created a new release of{" "}
        <strong>{project.name.trim()}</strong>.{" "}
        <ToastAnchor
          path={urlFromProject({
            pathWithNamespace: project.pathWithNamespace,
            ref: project.latestRelease.tag,
          })}
          query={queryParams}
          icon="eye"
        >
          OPEN RELEASED VERSION
        </ToastAnchor>
      </span>
    </SimulationToast>
  );
};
