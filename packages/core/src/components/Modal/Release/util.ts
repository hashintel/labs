import { SimulationProject } from "../../../features/project/types";

export const getCreateReleaseDescription = (project: SimulationProject) =>
  `Creating a release will create a${
    project.visibility === "public" ? " shareable" : ""
  } snapshot of your ${project.type.toLowerCase()}.`;
