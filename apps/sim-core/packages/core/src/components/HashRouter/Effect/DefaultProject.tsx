import { FC, useEffect, useRef } from "react";
import { useSelector, useStore } from "react-redux";
import { navigate } from "hookrouter";

import { selectBootstrapped } from "../../../features/user/selectors";
import { selectDefaultLinkableProject } from "../../../features/selectors";
import { urlFromProject } from "../../../routes";

export const HashRouterEffectDefaultProject: FC = () => {
  const store = useStore();
  const storeRef = useRef(store);

  storeRef.current = store;

  const bootstrapped = useSelector(selectBootstrapped);

  useEffect(() => {
    if (bootstrapped) {
      const defaultProject = selectDefaultLinkableProject(
        storeRef.current.getState()
      );

      if (!defaultProject) {
        throw new Error("Could not find a default project");
      }

      navigate(urlFromProject(defaultProject));
    }
  }, [bootstrapped]);

  return null;
};
