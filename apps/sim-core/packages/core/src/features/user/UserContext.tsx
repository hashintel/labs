import React, {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from "react";
import { isEqual } from "lodash-es";
import urljoin from "url-join";

import type { BasicUser, TourProgress, User } from "../../util/api/types";
import { PartialSimulationProject } from "../project/types";
import { SITE_URL } from "../../util/api/paths";
import { getLocalTourProgress, setLocalTourProgress } from "./local";
import { urlFromProject } from "../../routes";

interface UserState {
  tourProgress: TourProgress | null;
  isLoggedIn: boolean;
  currentUser: User | null;
  basicCurrentUser: BasicUser | null;
  projectsLoaded: boolean;
  bootstrapped: boolean;
  userProjects: PartialSimulationProject[];
}

type UserAction =
  | { type: "setTourProgress"; payload: TourProgress }
  | { type: "addUserProject"; payload: PartialSimulationProject }
  | { type: "setBasicUser"; payload: BasicUser }
  | {
      type: "bootstrap";
      payload: {
        user?: User;
        tourProgress: TourProgress | null;
        projects?: PartialSimulationProject[];
      };
    }
  | { type: "bootstrapFailed" };

function userReducer(state: UserState, action: UserAction): UserState {
  switch (action.type) {
    case "setTourProgress":
      return { ...state, tourProgress: action.payload };

    case "addUserProject": {
      const project = action.payload;
      const id = urlFromProject(project);
      const filtered = state.userProjects.filter(
        (p) => urlFromProject(p) !== id,
      );
      return { ...state, userProjects: [...filtered, project] };
    }

    case "setBasicUser":
      return {
        ...state,
        isLoggedIn: true,
        basicCurrentUser: action.payload,
      };

    case "bootstrap": {
      const { user, tourProgress, projects } = action.payload;
      return {
        ...state,
        bootstrapped: true,
        currentUser: user ?? null,
        basicCurrentUser: user ?? state.basicCurrentUser,
        isLoggedIn: !!user,
        tourProgress: tourProgress ?? state.tourProgress,
        projectsLoaded: !!projects,
        userProjects: projects ?? state.userProjects,
      };
    }

    case "bootstrapFailed":
      return {
        ...state,
        currentUser: null,
        basicCurrentUser: null,
        isLoggedIn: false,
        bootstrapped: false,
        tourProgress: null,
      };

    default:
      return state;
  }
}

const initialUserState: UserState = {
  tourProgress: getLocalTourProgress(),
  isLoggedIn: false,
  currentUser: null,
  basicCurrentUser: null,
  projectsLoaded: false,
  bootstrapped: false,
  userProjects: [],
};

export interface UserContextValue {
  isLoggedIn: boolean;
  currentUser: User | null;
  projectsLoaded: boolean;
  bootstrapped: boolean;
  tourProgress: TourProgress | null;
  userProjects: PartialSimulationProject[];
  userProfileUrl: string | null;
  userImage: string | null | undefined;

  setBasicUser: (user: BasicUser) => void;
  addUserProject: (project: PartialSimulationProject) => void;
  updateTourProgress: (progress: TourProgress) => void;
  bootstrapUser: (payload: {
    user?: User;
    tourProgress: TourProgress | null;
    projects?: PartialSimulationProject[];
  }) => void;
}

const UserContext = createContext<UserContextValue | null>(null);

export const useUser = () => {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be inside UserProvider");
  return ctx;
};

export const UserProvider: FC<PropsWithChildren> = ({ children }) => {
  const [state, dispatch] = useReducer(userReducer, initialUserState);

  const userProfileUrl = useMemo(
    () =>
      state.currentUser
        ? urljoin(SITE_URL, `@${state.currentUser.shortname}`)
        : null,
    [state.currentUser],
  );

  const setBasicUser = useCallback(
    (user: BasicUser) => dispatch({ type: "setBasicUser", payload: user }),
    [],
  );

  const addUserProject = useCallback(
    (project: PartialSimulationProject) =>
      dispatch({ type: "addUserProject", payload: project }),
    [],
  );

  const updateTourProgress = useCallback(
    (progress: TourProgress) => {
      if (isEqual(progress, state.tourProgress)) return;
      setLocalTourProgress(progress);
      dispatch({ type: "setTourProgress", payload: progress });
    },
    [state.tourProgress],
  );

  const bootstrapUser = useCallback(
    (payload: {
      user?: User;
      tourProgress: TourProgress | null;
      projects?: PartialSimulationProject[];
    }) => {
      dispatch({ type: "bootstrap", payload });
    },
    [],
  );

  const value = useMemo<UserContextValue>(
    () => ({
      isLoggedIn: state.isLoggedIn,
      currentUser: state.currentUser,
      projectsLoaded: state.projectsLoaded,
      bootstrapped: state.bootstrapped,
      tourProgress: state.tourProgress,
      userProjects: state.userProjects,
      userProfileUrl,
      userImage: state.currentUser?.image,
      setBasicUser,
      addUserProject,
      updateTourProgress,
      bootstrapUser,
    }),
    [
      state.isLoggedIn,
      state.currentUser,
      state.projectsLoaded,
      state.bootstrapped,
      state.tourProgress,
      state.userProjects,
      userProfileUrl,
      setBasicUser,
      addUserProject,
      updateTourProgress,
      bootstrapUser,
    ],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};
