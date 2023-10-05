import { useDispatch, useSelector } from "react-redux";
import { navigate } from "hookrouter";

import { AppDispatch } from "../features/types";
import { Scope, useScopes } from "../features/scopes";
import { forceLogIn } from "../features/user/utils";
import { save } from "../features/thunks";
import { selectForkCurrentProjectUrl } from "../features/project/selectors";

/**
 * @todo move to selector / thunk
 * @todo use selector
 */
export const useSaveOrFork = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { canForkIfSignedIn, canFork, canSave, canSaveIfSignedIn } = useScopes(
    Scope.fork,
    Scope.forkIfSignedIn,
    Scope.save,
    Scope.saveIfSignedIn
  );

  const forkUrl = useSelector(selectForkCurrentProjectUrl);

  const canSaveOrFork = canFork || canSave;
  const canSaveOrForkIfLoggedIn = canForkIfSignedIn || canSaveIfSignedIn;

  const saveOrFork = async () => {
    if (canSaveOrFork) {
      if (canSave) {
        await dispatch(save());
      } else if (canFork && forkUrl) {
        navigate(forkUrl);
      }
    } else if (canForkIfSignedIn) {
      forceLogIn();
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
