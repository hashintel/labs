import { useCallback, useEffect, useRef } from "react";

import { navigate, setQueryParams } from "../../../util/navigation";

import { LinkableProject } from "../../../features/project/types";
import { urlFromProject } from "../../../routes";
import { useProject } from "../../../features/project/ProjectContext";

/**
 * Ideally we'd be able to know if we've navigated in-app or loaded this URL
 * cold – but hookrouter doesn't tell us that. Instead, we're checking if a
 * project or an access gate is set, which is a pretty good indicator of that.
 *
 * @todo rewrite this when we move away from hookrouter
 * @todo we shouldn't need to manually recreate the previous URL
 */
export const useNavigateAway = (defaultProject?: LinkableProject | null) => {
  const defaultUrl = defaultProject ? urlFromProject(defaultProject) : null;
  const { accessGate, currentProjectUrl: projectUrl } = useProject();
  const accessGateUrl = accessGate?.url;
  const url = accessGateUrl ?? projectUrl ?? defaultUrl ?? "/";
  const queryParams = {};

  const dataRef = useRef({ url, queryParams });

  useEffect(() => {
    dataRef.current = { url, queryParams };
  });

  return useCallback((replace = false) => {
    navigate(dataRef.current.url, replace, dataRef.current.queryParams, true);
  }, []);
};

export const useLoggedInNavigateAway = (route?: string) => {
  const navigateAway = useNavigateAway();
  const routeRef = useRef(route);

  useEffect(() => {
    routeRef.current = route;
  });

  return useCallback(
    (loggedIn: boolean) => {
      if (loggedIn && routeRef.current) {
        navigate(`/${routeRef.current.replace(/^\/*/, "")}`, true, {}, true);
      } else {
        navigateAway(true);

        /**
         * Annoyingly hookrouter isn't removing a query parameter when going
         * back…
         *
         * @todo remove this when replacing hookrouter
         */
        setQueryParams({ route: undefined }, true);
      }
    },
    [navigateAway],
  );
};
