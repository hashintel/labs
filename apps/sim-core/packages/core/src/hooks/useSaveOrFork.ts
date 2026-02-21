import { navigate } from "../util/navigation";

import { Scope, useScopes } from "../features/scopes";
import { useFiles } from "../features/files/FilesContext";
import { useProject } from "../features/project/ProjectContext";

/**
 * @todo move to selector / thunk
 * @todo use selector
 */
export const useSaveOrFork = () => {
  const { filesDispatch } = useFiles();
  const { forkCurrentProjectUrl: forkUrl } = useProject();
  const { canForkIfSignedIn, canFork, canSave, canSaveIfSignedIn } = useScopes(
    Scope.fork,
    Scope.forkIfSignedIn,
    Scope.save,
    Scope.saveIfSignedIn,
  );

  const canSaveOrFork = canFork || canSave;
  const canSaveOrForkIfLoggedIn = canForkIfSignedIn || canSaveIfSignedIn;

  const saveOrFork = async () => {
    if (canSaveOrFork) {
      if (canSave) {
        // TODO: save() was an async thunk that saved to server.
        // In local-first mode, state is auto-persisted to localStorage.
        // This is a no-op for now.
        console.log("Local save triggered (auto-persisted)");
      } else if (canFork && forkUrl) {
        navigate(forkUrl);
      }
    }
  };

  return [
    saveOrFork,
    canSaveOrFork || canSaveOrForkIfLoggedIn,
    canSaveOrForkIfLoggedIn,
    {
      canForkIfSignedIn,
      canFork,
      canSave,
      canSaveIfSignedIn,
    },
  ] as const;
};
