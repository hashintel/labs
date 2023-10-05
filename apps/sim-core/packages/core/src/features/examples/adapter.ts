import { createEntityAdapter } from "@reduxjs/toolkit";

import { PartialSimulationProject } from "../project/types";
import { projectUpdatedSort } from "../utils";
import { urlFromProject } from "../../routes";

export const {
  getInitialState,
  getSelectors,
  upsertMany,
  removeAll,
} = createEntityAdapter<PartialSimulationProject>({
  selectId: (project) => urlFromProject(project),
  sortComparer: projectUpdatedSort,
});
