import { produce } from "immer";

import type { BasicUser, TourProgress } from "../../util/api/types";
import { PartialSimulationProject } from "../project/types";
import type { UserSlice } from "./types";
import { getLocalTourProgress } from "./local";

const initialState: UserSlice = {
  tourProgress: getLocalTourProgress(),
  isLoggedIn: false,
  currentUser: null,
  basicCurrentUser: null,
  projectsLoaded: false,
  bootstrapped: false,
  entities: {},
  ids: [],
};

export const setTourProgress = (payload: TourProgress) => ({
  type: "user/setTourProgress" as const,
  payload,
});

export const addUserProject = (payload: PartialSimulationProject) => ({
  type: "user/addUserProject" as const,
  payload,
});

export const setBasicUser = (payload: BasicUser) => ({
  type: "user/setBasicUser" as const,
  payload,
});

export const userReducer = (
  state: UserSlice = initialState,
  action: any,
): UserSlice => {
  return produce(state, (draft) => {
    switch (action.type) {
      case "user/setTourProgress":
        draft.tourProgress = action.payload;
        return;
      case "user/addUserProject": {
        const id = action.payload.pathWithNamespace;
        if (!draft.ids.includes(id)) {
          draft.ids.push(id);
        }
        (draft.entities as any)[id] = action.payload;
        return;
      }
      case "user/setBasicUser":
        draft.isLoggedIn = true;
        draft.basicCurrentUser = action.payload;
        return;
      default:
        return;
    }
  });
};
