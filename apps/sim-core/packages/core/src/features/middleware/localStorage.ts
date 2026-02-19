import { IS_DEV } from "../../util/api";
import { LocalStorageProject } from "../project/types";
import { localStorageProjectKey } from "../../util/localStorageProjectKey";
import { setItem } from "../../hooks/useLocalStorage";

export const setLocalStorageProject = (project: LocalStorageProject) => {
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
