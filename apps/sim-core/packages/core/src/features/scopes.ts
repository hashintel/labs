import { useMemo } from "react";

import { useFiles } from "./files/FilesContext";
import { useProject } from "./project/ProjectContext";
import { useUser } from "./user/UserContext";
import { useViewer } from "./viewer/ViewerContext";
import { globalsFileId, isReadOnly } from "./files/utils";
import { isProjectLatest } from "./project/utils";
import type { SimulationProject } from "./project/types";

/**
 * @note this must have the same key and value
 */
export enum Scope {
  useAccount = "useAccount",
  login = "login",
  useCloud = "useCloud",
  edit = "edit",
  mutate = "mutate",
  newProject = "newProject",
  newProjectIfSignedIn = "newProjectIfSignedIn",
  save = "save",
  saveIfSignedIn = "saveIfSignedIn",
  fork = "fork",
  forkIfSignedIn = "forkIfSignedIn",
  release = "release",
  generateAccessCode = "generateAccessCode",
  forkBehavior = "forkBehavior",
  uploadDataset = "uploadDataset",
  modifyFile = "modifyFile",
  saveFile = "saveFile",
  showOpenInCore = "showOpenInCore",
  linkToProjectInIndex = "linkToProjectInIndex",
}

const projectEditable = (project?: SimulationProject | null) =>
  project ? project.canUserEdit : false;

const loggedInOrEditable = (
  loggedIn: boolean,
  project: SimulationProject | null | undefined,
) => loggedIn || projectEditable(project);

/**
 * Compute scopes for a project that may not yet be in context state.
 * Used by setProjectWithMeta to compute toast scopes before the project is set.
 */
export const computeScopesForProject = (
  loggedIn: boolean,
  editorVisible: boolean,
) => (project: SimulationProject | null | undefined) => ({
  edit: loggedInOrEditable(loggedIn, project) && editorVisible,
  mutate: projectEditable(project),
});

/**
 * Replacement for the old `batchedScopes` that needed Redux selectors.
 * Returns a function that computes scopes for a given project.
 */
export const batchedScopes = {
  selectScopes: computeScopesForProject,
};

function computeAllScopes(
  loggedIn: boolean,
  embedded: boolean,
  editorVisible: boolean,
  currentProject: SimulationProject | null,
  currentFile: { kind: string } | undefined,
  hasProject: boolean,
): Record<Scope, boolean> {
  const isEditable = projectEditable(currentProject);
  const canEdit = loggedInOrEditable(loggedIn, currentProject) && editorVisible;
  const canMutate = isEditable;
  const notEmbedded = !embedded;
  const latest = !!currentProject && isProjectLatest(currentProject);
  const currentFileEditable =
    !!currentFile &&
    !isReadOnly(currentFile as any, loggedInOrEditable(loggedIn, currentProject));

  const canSave = latest && notEmbedded && canMutate;
  const canFork = hasProject && notEmbedded && loggedIn;

  return {
    [Scope.useAccount]: loggedIn,
    [Scope.login]: !loggedIn && notEmbedded,
    [Scope.useCloud]: loggedIn && hasProject && notEmbedded,
    [Scope.edit]: canEdit,
    [Scope.mutate]: canMutate,
    [Scope.newProject]: notEmbedded && loggedIn,
    [Scope.newProjectIfSignedIn]: notEmbedded && !loggedIn,
    [Scope.save]: canSave,
    [Scope.saveIfSignedIn]: latest && notEmbedded && !loggedIn,
    [Scope.fork]: canFork,
    [Scope.forkIfSignedIn]: hasProject && notEmbedded && !loggedIn,
    [Scope.release]: canSave && hasProject,
    [Scope.generateAccessCode]: loggedIn && canMutate && hasProject,
    [Scope.forkBehavior]: canFork && canMutate,
    [Scope.uploadDataset]: canSave && loggedIn && hasProject,
    [Scope.modifyFile]: editorVisible && currentFileEditable,
    [Scope.saveFile]: canSave && editorVisible && currentFileEditable,
    [Scope.showOpenInCore]: embedded && hasProject,
    [Scope.linkToProjectInIndex]: hasProject,
  };
}

export function useScope(scope: Scope): boolean {
  const { isLoggedIn } = useUser();
  const { currentProject } = useProject();
  const { editorVisible, embedded } = useViewer();
  const { currentFile } = useFiles();
  const hasProject = !!currentProject;

  return useMemo(
    () =>
      computeAllScopes(
        isLoggedIn,
        embedded,
        editorVisible,
        currentProject,
        currentFile,
        hasProject,
      )[scope],
    [isLoggedIn, embedded, editorVisible, currentProject, currentFile, hasProject, scope],
  );
}

type FilterArrayKeys<Key> = Key extends keyof Array<any> ? never : Key;
type ScopesReturn<T extends readonly Scope[]> = {
  [K in FilterArrayKeys<keyof T> as `can${Capitalize<T[K] & string>}`]: boolean;
};

export function useScopes<
  F extends Scope,
  S extends Scope,
  O extends Scope[],
>(
  firstScope: F,
  secondScope: S,
  ...otherScopes: O
): ScopesReturn<readonly [F, S, ...O]> {
  const { isLoggedIn } = useUser();
  const { currentProject } = useProject();
  const { editorVisible, embedded } = useViewer();
  const { currentFile } = useFiles();
  const hasProject = !!currentProject;

  const scopes = [firstScope, secondScope, ...otherScopes] as const;

  return useMemo(() => {
    const all = computeAllScopes(
      isLoggedIn,
      embedded,
      editorVisible,
      currentProject,
      currentFile,
      hasProject,
    );
    return Object.fromEntries(
      scopes.map((key) => [
        `can${key.slice(0, 1).toUpperCase()}${key.slice(1)}`,
        all[key],
      ]),
    ) as ScopesReturn<typeof scopes>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, embedded, editorVisible, currentProject, currentFile, hasProject]);
}

/**
 * Compatibility: the old scopes had selectScope[scope] as Redux selectors.
 * Some code still references this pattern. Keep it as a deprecated shim
 * that returns static values for local-first mode.
 *
 * @deprecated Use useScope() hook instead
 */
export const selectScope: Record<Scope, (state: any) => boolean> = Object.fromEntries(
  Object.values(Scope).map((scope) => [
    scope,
    (_state: any) => {
      switch (scope) {
        case Scope.useAccount:
          return true;
        case Scope.edit:
          return true;
        case Scope.mutate:
          return true;
        case Scope.save:
          return true;
        case Scope.login:
          return false;
        default:
          return false;
      }
    },
  ]),
) as unknown as Record<Scope, (state: any) => boolean>;

/**
 * @deprecated Use context values instead
 */
export const selectVisualGlobalsVisible = () => false;

/**
 * @deprecated Use context values instead
 */
export const selectCanToggleVisualGlobals = () => false;

/**
 * @deprecated Use context values instead
 */
export const selectShouldShowExperimentsButton = () => false;
