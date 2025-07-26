import { EntityState } from "@reduxjs/toolkit";

import { PartialSimulationProject } from "../project/types";

export interface ExamplesSlice extends EntityState<PartialSimulationProject> {
  examplesLoaded: boolean;
}
