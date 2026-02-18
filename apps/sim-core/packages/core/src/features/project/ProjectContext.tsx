/**
 * Facade over the Redux project slice. Consumers use `useProject()` instead of
 * `useSelector`/`useDispatch`. Internally still reads from Redux until all
 * slices are migrated.
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

import type { AppDispatch } from "../types";
import type {
  LinkableProject,
  SimulationProject,
  SimulationProjectWithHcFiles,
  LocalStorageProject,
} from "./types";
import type { HashCoreAccessGateKindWithProps } from "../../components/HashCore/AccessGate";
import { forkUrlFromProject, urlFromProject } from "../../routes";
import {
  selectAccessGate,
  selectCurrentProject,
  selectCurrentProjectUrl,
  selectHasProject,
  selectProjectLoaded,
  selectProjectRef,
  selectVersionSwitchingTo,
} from "./selectors";
import { fetchProject as fetchProjectThunk, setAccessGate as setAccessGateAction } from "./slice";
import { setProjectWithMeta } from "../actions";

export interface ProjectContextValue {
  currentProject: SimulationProject | null;
  currentProjectUrl: string | null;
  projectLoaded: boolean;
  hasProject: boolean;
  accessGate: (HashCoreAccessGateKindWithProps & { url: string | null }) | null;
  projectRef: string | null;
  forkCurrentProjectUrl: string | null;
  versionSwitchingTo: string | null;

  fetchProject: (args: {
    project: LinkableProject;
    fromLegacy?: boolean;
    file?: string;
    redirect?: boolean;
  }) => any;
  setAccessGate: (payload: {
    accessGate: HashCoreAccessGateKindWithProps;
    url: string | null;
  }) => void;
  setProjectWithMeta: (
    project: SimulationProjectWithHcFiles | LocalStorageProject,
    meta?: { fromLegacy?: boolean; replaceTabs?: boolean; file?: string },
  ) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export const useProject = () => {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be inside ProjectProvider");
  return ctx;
};

export const ProjectProvider: FC<PropsWithChildren> = ({ children }) => {
  const dispatch = useDispatch<AppDispatch>();

  const currentProject = useSelector(selectCurrentProject);
  const currentProjectUrl = useSelector(selectCurrentProjectUrl);
  const projectLoaded = useSelector(selectProjectLoaded);
  const hasProject = useSelector(selectHasProject);
  const accessGate = useSelector(selectAccessGate);
  const projectRef = useSelector(selectProjectRef);
  const versionSwitchingTo = useSelector(selectVersionSwitchingTo);

  const forkCurrentProjectUrl = useMemo(
    () => (currentProject ? forkUrlFromProject(currentProject) : null),
    [currentProject],
  );

  const fetchProject = useCallback(
    (args: {
      project: LinkableProject;
      fromLegacy?: boolean;
      file?: string;
      redirect?: boolean;
    }) => dispatch(fetchProjectThunk(args) as any),
    [dispatch],
  );

  const setAccessGate = useCallback(
    (payload: {
      accessGate: HashCoreAccessGateKindWithProps;
      url: string | null;
    }) => dispatch(setAccessGateAction(payload)),
    [dispatch],
  );

  const setProjectWithMetaCb = useCallback(
    (
      project: SimulationProjectWithHcFiles | LocalStorageProject,
      meta?: { fromLegacy?: boolean; replaceTabs?: boolean; file?: string },
    ) => dispatch(setProjectWithMeta(project, meta) as any),
    [dispatch],
  );

  const value = useMemo<ProjectContextValue>(
    () => ({
      currentProject,
      currentProjectUrl,
      projectLoaded,
      hasProject,
      accessGate,
      projectRef,
      forkCurrentProjectUrl,
      versionSwitchingTo,
      fetchProject,
      setAccessGate,
      setProjectWithMeta: setProjectWithMetaCb,
    }),
    [
      currentProject,
      currentProjectUrl,
      projectLoaded,
      hasProject,
      accessGate,
      projectRef,
      forkCurrentProjectUrl,
      versionSwitchingTo,
      fetchProject,
      setAccessGate,
      setProjectWithMetaCb,
    ],
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
};
