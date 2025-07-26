import { EntityState } from "@reduxjs/toolkit";

import type { BasicUser, TourProgress, User } from "../../util/api/types";
import { PartialSimulationProject } from "../project/types";

export interface UserSlice extends EntityState<PartialSimulationProject> {
  isLoggedIn: boolean;
  currentUser: User | null;
  /**
   * Sometimes its possible to be logged in but not have a full user – i.e,
   * when in embedded mode
   */
  basicCurrentUser: BasicUser | null;
  projectsLoaded: boolean;
  bootstrapped: boolean;
  tourProgress: TourProgress | null;
}
