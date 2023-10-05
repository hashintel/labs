import { Middleware } from "@reduxjs/toolkit";

import { IS_DEV } from "../../util/api";
import { LocalStorageProject } from "../project/types";
import type { RootState } from "../types";
import { Scope, selectScope } from "../scopes";
import { localStorageProjectKey } from "../../util/localStorageProjectKey";
import { removeItem, setItem } from "../../hooks/useLocalStorage";
import { selectAllFiles, selectFileActions } from "../files/selectors";
import {
  selectCurrentProject,
  selectProjectUpdated,
} from "../project/selectors";

const setLocalStorageProject = (project: LocalStorageProject) => {
  /**
   * This flag allows you to avoid saving projects to localStorage whilst in
   * dev mode. This is useful for if you're working on something that requires
   * the structure of projects to change frequently throughout development.
   *
   * @todo Implement proper versioning of local storage backups
   */
  if (IS_DEV && localStorage.__CORE__DEV__MODE__) {
    return;
  }

  setItem(localStorageProjectKey(project), project);
};

export const localStorageMiddleware: Middleware<{}, RootState> = ({
  getState,
}) => (next) => (action) => {
  const prevState = getState();
  const prevProject = selectCurrentProject(prevState);
  const result = next(action);
  const nextState = getState();

  const canSave = selectScope[Scope.save](nextState);
  const project = selectCurrentProject(nextState);
  const actions = selectFileActions(nextState);
  const projectChange = prevProject !== project;

  if (
    project &&
    canSave &&
    (selectFileActions(prevState) !== actions ||
      selectProjectUpdated(prevState) !== selectProjectUpdated(nextState))
  ) {
    const files = selectAllFiles(nextState);

    if ((files.length && actions.length) || projectChange) {
      setLocalStorageProject({
        ...project,
        actions,
        files,
      });
    } else {
      console.log(
        "Removing project from localstorage",
        project.pathWithNamespace
      );
      removeItem(localStorageProjectKey(project));
    }
  }

  return result;
};
