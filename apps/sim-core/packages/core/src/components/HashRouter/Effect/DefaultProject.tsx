import { FC, useEffect, useRef } from "react";
import { useStore } from "react-redux";
import { navigate } from "../../../util/navigation";

import { selectDefaultLinkableProject } from "../../../features/selectors";
import { urlFromProject } from "../../../routes";
import { useUser } from "../../../features/user/UserContext";

export const HashRouterEffectDefaultProject: FC = () => {
  const store = useStore();
  const storeRef = useRef(store);

  storeRef.current = store;

  const { bootstrapped } = useUser();

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
