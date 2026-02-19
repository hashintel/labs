import React, {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from "react";
import omit from "lodash/omit";

import type {
  LinkableProject,
  ProjectSlice,
  SimulationProject,
  SimulationProjectWithHcFiles,
  LocalStorageProject,
} from "./types";
import type { HashCoreAccessGateKindWithProps } from "../../components/HashCore/AccessGate";
import { forkUrlFromProject, urlFromProject } from "../../routes";
import { navigate } from "../../util/navigation";
import {
  HashCoreAccessGateKind,
} from "../../components/HashCore/AccessGate";
import { getLocalStorageProject, isProjectLatest, isStoringProjectActions } from "./utils";
import { globalsFileId } from "../files/utils";
import { setProject } from "../actions";
import { useFiles } from "../files/FilesContext";
import { useToast } from "../toast/ToastContext";
import { useViewer } from "../viewer/ViewerContext";

type ProjectAction =
  | { type: "setProject"; payload: { project: SimulationProjectWithHcFiles | LocalStorageProject } }
  | { type: "setAccessGate"; payload: { accessGate: HashCoreAccessGateKindWithProps; url: string | null } }
  | { type: "projectUpdated"; payload: { updatedAt: string; update?: Partial<SimulationProject> } }
  | { type: "canUserEditUpdate"; payload: { canUserEdit: boolean } }
  | { type: "fetchPending"; payload: { project: LinkableProject } }
  | { type: "fetchRejected" }
  | { type: "fetchCompleted" };

function projectReducer(state: ProjectSlice, action: ProjectAction): ProjectSlice {
  switch (action.type) {
    case "setProject": {
      const project = action.payload.project;
      return {
        ...state,
        currentProject: omit(project, "files", "dependencies", "actions") as SimulationProject,
        projectLoaded: true,
        accessGate: null,
        pendingProject: null,
      };
    }

    case "setAccessGate":
      return {
        ...state,
        accessGate: { ...action.payload.accessGate, url: action.payload.url },
        currentProject: null,
      };

    case "projectUpdated": {
      if (!state.currentProject) {
        throw new Error("Cannot update project that does not exist");
      }
      return {
        ...state,
        currentProject: {
          ...state.currentProject,
          updatedAt: action.payload.updatedAt,
          ...(action.payload.update ?? {}),
        },
      };
    }

    case "canUserEditUpdate": {
      if (!state.currentProject) {
        throw new Error("Cannot update project that does not exist");
      }
      return {
        ...state,
        currentProject: {
          ...state.currentProject,
          canUserEdit: action.payload.canUserEdit,
        },
      };
    }

    case "fetchPending":
      return {
        ...state,
        projectLoaded: false,
        accessGate: null,
        pendingProject: action.payload.project,
      };

    case "fetchRejected":
      return { ...state, pendingProject: null };

    case "fetchCompleted":
      return { ...state, pendingProject: null };

    default:
      return state;
  }
}

const projectInitialState: ProjectSlice = {
  projectLoaded: false,
  accessGate: null,
  currentProject: null,
  pendingProject: null,
};

export interface ProjectContextValue {
  currentProject: SimulationProject | null;
  currentProjectUrl: string | null;
  projectLoaded: boolean;
  accessGate: (HashCoreAccessGateKindWithProps & { url: string | null }) | null;
  projectRef: string | null;
  forkCurrentProjectUrl: string | null;
  versionSwitchingTo: string | null;
  projectConfig: SimulationProject["config"] | null;
  projectPublishedFiles: string[];
  hasProject: boolean;

  fetchProject: (args: {
    project: LinkableProject;
    fromLegacy?: boolean;
    file?: string;
    redirect?: boolean;
  }) => Promise<boolean>;
  setAccessGate: (payload: {
    accessGate: HashCoreAccessGateKindWithProps;
    url: string | null;
  }) => void;
  setProjectWithMeta: (
    project: SimulationProjectWithHcFiles | LocalStorageProject,
    meta?: { fromLegacy?: boolean; replaceTabs?: boolean; file?: string },
  ) => void;
  projectUpdated: (payload: {
    updatedAt: string;
    update?: Partial<SimulationProject>;
    actions?: { uuid: string }[];
  }) => void;
  canUserEditUpdate: (canUserEdit: boolean) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export const useProject = () => {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be inside ProjectProvider");
  return ctx;
};

export const ProjectProvider: FC<PropsWithChildren> = ({ children }) => {
  const [state, dispatch] = useReducer(projectReducer, projectInitialState);
  const { filesDispatch } = useFiles();
  const toast = useToast();
  const viewer = useViewer();

  const currentProjectUrl = useMemo(
    () => (state.currentProject ? urlFromProject(state.currentProject) : null),
    [state.currentProject],
  );

  const forkCurrentProjectUrl = useMemo(
    () =>
      state.currentProject ? forkUrlFromProject(state.currentProject) : null,
    [state.currentProject],
  );

  const projectRef = state.currentProject
    ? state.currentProject.ref ?? "main"
    : null;

  const versionSwitchingTo = useMemo(
    () =>
      state.pendingProject &&
      state.currentProject?.pathWithNamespace ===
        state.pendingProject.pathWithNamespace
        ? state.pendingProject.ref ?? "main"
        : null,
    [state.pendingProject, state.currentProject],
  );

  const projectConfig = state.currentProject?.config ?? null;
  const projectPublishedFiles = useMemo(
    () => projectConfig?.files ?? [],
    [projectConfig],
  );

  /**
   * Computes scopes for a project. In local-first mode, the project is
   * always editable and the user is always "logged in" (local user).
   */
  const computeScopes = useCallback(
    (project: SimulationProjectWithHcFiles | LocalStorageProject | SimulationProject | null) => {
      const editable = project ? project.canUserEdit : false;
      const canEdit = (true || editable) && viewer.editorVisible;
      const canMutate = editable;
      return { canEdit, canMutate };
    },
    [viewer.editorVisible],
  );

  const setProjectWithMeta = useCallback(
    (
      project: SimulationProjectWithHcFiles | LocalStorageProject,
      meta: { fromLegacy?: boolean; replaceTabs?: boolean; file?: string } = {},
    ) => {
      const scopes = computeScopes(project);

      dispatch({ type: "setProject", payload: { project } });

      const setProjectAction = setProject({
        project,
        meta,
        scopes: { edit: scopes.canEdit, mutate: scopes.canMutate },
      });
      filesDispatch(setProjectAction);

      viewer.onProjectChanged();

      toast.setToastForProject(
        omit(project, "files", "dependencies", "actions") as SimulationProject,
        scopes.canEdit,
        scopes.canMutate,
        meta.fromLegacy,
      );
    },
    [computeScopes, filesDispatch, toast, viewer, dispatch],
  );

  const setAccessGate = useCallback(
    (payload: {
      accessGate: HashCoreAccessGateKindWithProps;
      url: string | null;
    }) => {
      dispatch({ type: "setAccessGate", payload });
    },
    [],
  );

  const projectUpdated = useCallback(
    (payload: {
      updatedAt: string;
      update?: Partial<SimulationProject>;
      actions?: { uuid: string }[];
    }) => {
      dispatch({
        type: "projectUpdated",
        payload: { updatedAt: payload.updatedAt, update: payload.update },
      });

      if (payload.actions) {
        const { projectUpdated: puAction } = require("../actions") as typeof import("../actions");
        filesDispatch(puAction(payload));
      }
    },
    [filesDispatch],
  );

  const canUserEditUpdate = useCallback(
    (canUserEdit: boolean) => {
      dispatch({ type: "canUserEditUpdate", payload: { canUserEdit } });
    },
    [],
  );

  const fetchProject = useCallback(
    async (args: {
      project: LinkableProject;
      fromLegacy?: boolean;
      file?: string;
      redirect?: boolean;
    }): Promise<boolean> => {
      const { project: linkable, fromLegacy = false, file, redirect = true } = args;
      const refWithDefault = linkable.ref ?? "main";

      dispatch({ type: "fetchPending", payload: { project: linkable } });

      try {
        const project = getLocalStorageProject(
          linkable.pathWithNamespace,
          refWithDefault,
        );

        if (!project) {
          console.warn(
            "Attempted to fetch project from localstorage, but could not.",
            linkable.pathWithNamespace,
            linkable.ref,
          );

          setAccessGate({
            accessGate: {
              kind: HashCoreAccessGateKind.NotFound,
              props: { requestedProject: null },
            },
            url: linkable.pathWithNamespace,
          });

          return false;
        }

        const scopes = computeScopes(project);
        const selectedFile =
          file ?? (scopes.canEdit ? undefined : globalsFileId);

        setProjectWithMeta(project, { fromLegacy, file: selectedFile });

        if (redirect) {
          navigate(urlFromProject(project), true, {}, false);
        }

        return true;
      } catch (err) {
        dispatch({ type: "fetchRejected" });
        throw err;
      }
    },
    [setAccessGate, setProjectWithMeta, computeScopes],
  );

  const value = useMemo<ProjectContextValue>(
    () => ({
      currentProject: state.currentProject,
      currentProjectUrl,
      projectLoaded: state.projectLoaded,
      accessGate: state.accessGate,
      projectRef,
      forkCurrentProjectUrl,
      versionSwitchingTo,
      projectConfig,
      projectPublishedFiles,
      hasProject: !!state.currentProject,
      fetchProject,
      setAccessGate,
      setProjectWithMeta,
      projectUpdated,
      canUserEditUpdate,
    }),
    [
      state.currentProject,
      currentProjectUrl,
      state.projectLoaded,
      state.accessGate,
      projectRef,
      forkCurrentProjectUrl,
      versionSwitchingTo,
      projectConfig,
      projectPublishedFiles,
      fetchProject,
      setAccessGate,
      setProjectWithMeta,
      projectUpdated,
      canUserEditUpdate,
    ],
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
};
