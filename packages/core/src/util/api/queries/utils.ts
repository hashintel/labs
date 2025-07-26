import {
  ProjectAccess,
  RemoteSimulationProject,
  SimulationProjectWithHcFiles,
} from "../../../features/project/types";
import { toHcConfig } from "../../../features/project/utils";
import { toHcFiles } from "../../../features/files/utils";

export const prepareRemoteProject = (
  remoteProject: RemoteSimulationProject,
  access: ProjectAccess,
): SimulationProjectWithHcFiles => {
  const project = {
    ...remoteProject,
    config: toHcConfig(remoteProject),
    ref: remoteProject.ref ?? "main",
    access,
  };

  return { ...project, files: toHcFiles(project) };
};
