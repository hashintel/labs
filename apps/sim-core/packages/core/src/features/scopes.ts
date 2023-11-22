import { useMemo } from "react";
import { useSelector } from "react-redux";
import { createSelector, Selector } from "@reduxjs/toolkit";

import { ProjectAccessScope, projectAccessLevelScopes } from "../shared/scopes";
import { RootState } from "./types";
import { SimulationProject } from "./project/types";
import { globalsFileId, isReadOnly } from "./files/utils";
import { isProjectLatest } from "./project/utils";
import {
  selectCurrentFile,
  selectCurrentFileId,
  selectFilesSlice,
} from "./files/selectors";
import {
  selectCurrentProject,
  selectHasProject,
  selectProjectAccess,
} from "./project/selectors";
import { selectEditorVisible, selectEmbedded } from "./viewer/selectors";
import { selectExperiments } from "../components/SimulationRunner/Controls/Experiments/selectors";
import { selectUserSlice } from "./user/selectors";

const projectAccessScopes = (project: SimulationProject) =>
  project.access
    ? projectAccessLevelScopes[project.access.level]
    : project.canUserEdit
      ? projectAccessLevelScopes.Write
      : projectAccessLevelScopes.Read;

const projectEditable = (project?: SimulationProject | null) =>
  project
    ? projectAccessScopes(project).includes(ProjectAccessScope.Write)
    : false;

const loggedInOrEditable = (
  loggedIn: boolean,
  project: SimulationProject | null | undefined,
) => {
  const editable = projectEditable(project);

  return loggedIn || editable;
};

const helpers = (() => {
  const selectLoggedIn = createSelector(
    selectUserSlice,
    (user) => user.isLoggedIn,
  );

  const selectAccessScopes = createSelector(selectCurrentProject, (project) =>
    project ? projectAccessScopes(project) : null,
  );

  return {
    loggedIn: selectLoggedIn,
    notLoggedIn: createSelector([selectLoggedIn], (loggedIn) => !loggedIn),
    notEmbedded: createSelector([selectEmbedded], (embedded) => !embedded),

    currentFileEditable: createSelector(
      [selectCurrentFile, selectLoggedIn, selectCurrentProject],
      (currentFile, loggedIn, project) =>
        !!currentFile &&
        !isReadOnly(currentFile, loggedInOrEditable(loggedIn, project)),
    ),

    projectEditable: createSelector([selectCurrentProject], projectEditable),

    projectLatest: createSelector(
      [selectCurrentProject],
      (project) => !!project && isProjectLatest(project),
    ),

    projectWithoutAccess: createSelector(
      [selectHasProject, selectProjectAccess],
      (hasProject, access) => hasProject && !access,
    ),

    projectWithoutEmbedOnlyAccess: createSelector(
      [selectHasProject, selectAccessScopes],
      (hasProject, scopes) =>
        hasProject && (scopes?.includes(ProjectAccessScope.Read) ?? false),
    ),
  };
})();

/**
 * @note this must have the same key and value
 */
export enum Scope {
  /**
   * indicates if the user is logged into an account we can make use of (i.e, to
   * display a profile image or talk to authenticated APIs). Is a foundational
   * scope used by lots of other scopes
   */
  useAccount = "useAccount",

  /**
   * sort of the inverse of `useAccount`, except there are contexts in which we
   * don't allow users to login, i.e, in embedded mode. Used to decide whether
   * to show the login prompt or guide users to login.
   */
  login = "login",

  /**
   * This is distinct from useAccount, because we cannot use cloud when the use
   * of project access tokens is necessary for access to the project
   * (as cloud does not yet support them)
   *
   * @todo need a `useCloudIfSignedIn`, because there are contexts where you
   *       cannot use cloud even once signed in
   */
  useCloud = "useCloud",

  /**
   * This represents the project being in an editable (but not necessarily
   * saveable!) state – i.e, monaco shouldn't be in read only mode. Globals
   * are always editable via the visual globals editor, as we don't have a
   * read only globals visualiser (and besides, we want to enable users to
   * modify parameters of simulations, even if they cannot persist those
   * changes)
   */
  edit = "edit",

  /**
   * mutateProject is a scope mostly available to be used by other scopes – it
   * represents that the user has write access to the repository (but not
   * necessarily the current release). This will be either because of their
   * account owning the repo or being in the org, or in the future due to
   * write access tokens. Maps to `project.canUserEdit`
   */
  mutate = "mutate",

  /**
   * In some cases, we prompt users to sign in when attempting to use a scope
   * (usually using the Link component), but we need to know whether to even
   * show the components that trigger that prompt, because in some cases it is
   * not being signed out that causes the scope to be unavailable. For that
   * reason we have a few scopes suffixed with `IfSignedIn` which are identical,
   * except that `useAccount` is replaced with `login`.
   */
  newProject = "newProject",
  newProjectIfSignedIn = "newProjectIfSignedIn",

  save = "save",
  saveIfSignedIn = "saveIfSignedIn",

  fork = "fork",
  forkIfSignedIn = "forkIfSignedIn",

  release = "release",
  /**
   * @todo this needs to be used
   */
  generateAccessCode = "generateAccessCode",

  forkBehavior = "forkBehavior",

  /**
   * This is currently just the same as `save`, but because uploading datasets
   * necessitates being logged in, and save won't always necessitate that,
   * we need a separate scope for uploading datasets.
   */
  uploadDataset = "uploadDataset",

  /**
   * This just tells us if the currently open file is read only or not, taking
   * into account whether the user can mutate the project or not (as different
   * files are read only or not based on that)
   */
  modifyFile = "modifyFile",

  /**
   * This is the union of modifyFile & save. This is currently used to decide
   * whether to allow a user to modify behavior keys – because we don't have
   * a read only behavior keys UI, and we don't want people making complex
   * changes to the behavior keys just to realise they cannot persist them
   */
  saveFile = "saveFile",

  /**
   * Controls the visibility of the "open in core" button in the bottom right
   * of embedded mode
   */
  showOpenInCore = "showOpenInCore",

  /**
   * We cannot always link to project in the index because index doesn't
   * support access codes
   */
  linkToProjectInIndex = "linkToProjectInIndex",
}

type ScopeSelector = Selector<RootState, boolean>;
type ScopeSelectorOrAlias = ScopeSelector | Scope;

type ScopeSelectorList = ScopeSelectorOrAlias[];

const createSelectorForSelectorChain = <T>(
  selectorChain: ScopeSelectorList,
  existingSelectors: T,
): ScopeSelector =>
  createSelector(
    selectorChain.map((selector): ScopeSelector => {
      if (typeof selector === "function") {
        return selector;
      } else if (
        typeof selector === "string" &&
        selector in existingSelectors
      ) {
        return (existingSelectors as any)[selector];
      }

      throw new Error(
        "Attempting to use scope as an alias for a selector before it has been defined defined",
      );
    }),
    (...results) => results.every((result) => result),
  );

/**
 * We batch edit and mutateProject scopes as we need to know these before the
 * project is in the store for setting toasts (which is done simultaneously to
 * putting a project in the store). This means we need to be specific about
 * what fields these two depend on.
 */
export const batchedScopes = (() => {
  /**
   * @todo look into executing these separately
   */
  const scopesForProject =
    (loggedIn: boolean, editorVisible: boolean) =>
    (project: SimulationProject | null | undefined) => ({
      [Scope.edit]: loggedInOrEditable(loggedIn, project) && editorVisible,
      [Scope.mutate]: projectEditable(project),
    });

  const selectScopes = createSelector(
    [helpers.loggedIn, selectEditorVisible],
    scopesForProject,
  );

  const selectScopesForCurrentProject = createSelector(
    [selectScopes, selectCurrentProject],
    (selectScopesForProject, currentProject) =>
      selectScopesForProject(currentProject),
  );

  const makeSelectScope = (scope: Scope.edit | Scope.mutate) =>
    createSelector([selectScopesForCurrentProject], (scopes) => scopes[scope]);

  return {
    makeSelectScope,
    selectScopes,
  };
})();

const newProjectSelectors: ScopeSelectorList = [helpers.notEmbedded];
const saveSelectors: ScopeSelectorList = [
  helpers.projectLatest,
  helpers.notEmbedded,
];

const forkSelectors: ScopeSelectorList = [
  helpers.projectWithoutAccess,
  helpers.notEmbedded,
];

/**
 * This is a map between scopes, and an array of selectors that will be combined
 * to create a selector for that scope in `selectScope`'s definition below
 */
const scopes: Record<Scope, ScopeSelectorList> = {
  [Scope.useAccount]: [helpers.loggedIn],
  [Scope.login]: [helpers.notLoggedIn, helpers.notEmbedded],

  [Scope.useCloud]: [
    Scope.useAccount,
    helpers.projectWithoutAccess,
    helpers.notEmbedded,
  ],

  /**
   * @todo we should consider basing this on save & fork – because
   *       we shouldn't allow people to make changes if they'll be unable to
   *       persist them one way or another
   */
  [Scope.edit]: [batchedScopes.makeSelectScope(Scope.edit)],

  [Scope.mutate]: [batchedScopes.makeSelectScope(Scope.mutate)],

  [Scope.newProject]: [...newProjectSelectors, Scope.useAccount],
  [Scope.newProjectIfSignedIn]: [...newProjectSelectors, Scope.login],

  [Scope.save]: [...saveSelectors, Scope.mutate],
  [Scope.saveIfSignedIn]: [...saveSelectors, Scope.login],

  [Scope.fork]: [...forkSelectors, Scope.useAccount],
  [Scope.forkIfSignedIn]: [...forkSelectors, Scope.login],

  [Scope.release]: [Scope.save, helpers.projectWithoutAccess],
  [Scope.generateAccessCode]: [
    Scope.useAccount,
    Scope.mutate,
    helpers.projectWithoutAccess,
  ],

  [Scope.forkBehavior]: [...forkSelectors, Scope.useAccount, Scope.mutate],

  [Scope.uploadDataset]: [
    Scope.save,
    Scope.useAccount,
    helpers.projectWithoutAccess,
  ],

  [Scope.modifyFile]: [selectEditorVisible, helpers.currentFileEditable],
  [Scope.saveFile]: [Scope.save, Scope.modifyFile],

  [Scope.showOpenInCore]: [
    selectEmbedded,
    helpers.projectWithoutEmbedOnlyAccess,
  ],

  [Scope.linkToProjectInIndex]: [helpers.projectWithoutAccess],
};

const scopeEntries = Object.entries(scopes) as [Scope, ScopeSelectorList][];

/**
 * @todo try and type this better
 */
export const selectScope: Record<Scope, ScopeSelector> = scopeEntries.reduce(
  <T, S extends Scope>(
    existingSelectors: T,
    [scope, selectorChain]: [S, ScopeSelectorList],
  ): T & { [key in S]: ScopeSelector } =>
    ({
      ...existingSelectors,
      [scope]: createSelectorForSelectorChain(selectorChain, existingSelectors),
    }) as any,
  {} as any,
);

/**
 * @deprecated
 * @todo replace with scopes
 */
const selectVisualGlobalsVisibleOverwrite = createSelector(
  [selectScope[Scope.edit]],
  (canEdit) => !canEdit,
);

/**
 * @deprecated
 * @todo replace with scopes
 */
export const selectVisualGlobalsVisible = createSelector(
  [selectVisualGlobalsVisibleOverwrite, selectFilesSlice],
  (visible, filesSlice) => visible || filesSlice.visualGlobals,
);

/**
 * @deprecated
 * @todo replace with scopes
 */
export const selectCanToggleVisualGlobals = createSelector(
  [selectVisualGlobalsVisibleOverwrite, selectCurrentFileId],
  (visible, currentFileId) => !visible && currentFileId === globalsFileId,
);

/**
 * @deprecated
 * @todo replace with scopes
 */
export const selectShouldShowExperimentsButton = createSelector(
  [selectEmbedded, selectScope[Scope.edit], selectExperiments],
  (embedded, canEdit, experiments) =>
    !embedded && (canEdit || Object.keys(experiments ?? {}).length > 0),
);

export const useScope = (scope: Scope) => useSelector(selectScope[scope]);

type FilterArrayKeys<Key> = Key extends keyof any[] ? never : Key;
type ScopesReturn<T extends readonly Scope[]> = {
  [K in FilterArrayKeys<keyof T> as `can${Capitalize<T[K] & string>}`]: boolean;
};

const makeSpecificSelectScopes = <T extends readonly Scope[]>(list: T) =>
  createSelector(
    list.map((scope) => selectScope[scope]),
    (...results) =>
      Object.fromEntries(
        list.map((key, idx) => [
          `can${key.slice(0, 1).toUpperCase()}${key.slice(1)}`,
          results[idx],
        ]),
      ) as ScopesReturn<T>,
  );

/**
 * @see useScope for single scope usage
 * @todo look into performance of this vs individual subscriptions
 */
export const useScopes = <F extends Scope, S extends Scope, O extends Scope[]>(
  firstScope: F,
  secondScope: S,
  ...otherScopes: O
): ScopesReturn<readonly [F, S, ...O]> => {
  const scopes = [firstScope, secondScope, ...otherScopes] as const;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selector = useMemo(() => makeSpecificSelectScopes(scopes), scopes);

  return useSelector(selector);
};
