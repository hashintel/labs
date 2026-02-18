/**
 * Facade over the Redux user slice. Consumers use `useUser()` instead of
 * `useSelector`/`useDispatch`. Internally this still reads from Redux so that
 * the scopes system, sync.ts, and cross-slice extraReducers keep working.
 *
 * When all slices are migrated and scopes are rebuilt (Phase B/C), the
 * internals will be swapped to pure React state with no Redux dependency.
 */
import React, {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { useDispatch, useSelector } from "react-redux";
import urljoin from "url-join";

import type { BasicUser, TourProgress, User } from "../../util/api/types";
import type { AppDispatch } from "../types";
import { PartialSimulationProject } from "../project/types";
import { SITE_URL } from "../../util/api/paths";
import {
  selectBootstrapped,
  selectCurrentUser,
  selectTourProgress,
  selectUserImage,
  selectUserProjects,
  selectUserProjectsLoaded,
} from "./selectors";
import {
  addUserProject as addUserProjectAction,
  setBasicUser as setBasicUserAction,
} from "./slice";
import { tourProgress as tourProgressThunk } from "./thunks";

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
}

const UserContext = createContext<UserContextValue | null>(null);

export const useUser = () => {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be inside UserProvider");
  return ctx;
};

export const UserProvider: FC<PropsWithChildren> = ({ children }) => {
  const dispatch = useDispatch<AppDispatch>();

  const bootstrapped = useSelector(selectBootstrapped);
  const currentUser = useSelector(selectCurrentUser);
  const progress = useSelector(selectTourProgress);
  const userProjects = useSelector(selectUserProjects);
  const projectsLoaded = useSelector(selectUserProjectsLoaded);
  const userImage = useSelector(selectUserImage);

  const isLoggedIn = !!currentUser;

  const userProfileUrl = useMemo(
    () =>
      currentUser
        ? urljoin(SITE_URL, `@${currentUser.shortname}`)
        : null,
    [currentUser],
  );

  const setBasicUser = useCallback(
    (user: BasicUser) => dispatch(setBasicUserAction(user)),
    [dispatch],
  );

  const addUserProject = useCallback(
    (project: PartialSimulationProject) =>
      dispatch(addUserProjectAction(project)),
    [dispatch],
  );

  const updateTourProgress = useCallback(
    (prog: TourProgress) => {
      dispatch(tourProgressThunk(prog) as any);
    },
    [dispatch],
  );

  const value = useMemo<UserContextValue>(
    () => ({
      isLoggedIn,
      currentUser,
      projectsLoaded,
      bootstrapped,
      tourProgress: progress,
      userProjects,
      userProfileUrl,
      userImage,
      setBasicUser,
      addUserProject,
      updateTourProgress,
    }),
    [
      isLoggedIn,
      currentUser,
      projectsLoaded,
      bootstrapped,
      progress,
      userProjects,
      userProfileUrl,
      userImage,
      setBasicUser,
      addUserProject,
      updateTourProgress,
    ],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};
