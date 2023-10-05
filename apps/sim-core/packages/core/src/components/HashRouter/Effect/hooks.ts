import { useCallback, useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import { navigate, setQueryParams } from "hookrouter";

import { LinkableProject } from "../../../features/project/types";
import {
  selectAccessGate,
  selectCurrentProjectUrl,
  selectProjectAccess,
} from "../../../features/project/selectors";
import { urlFromProject } from "../../../routes";

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
  const accessGateUrl = useSelector(selectAccessGate)?.url;
  const projectUrl = useSelector(selectCurrentProjectUrl);
  const access = useSelector(selectProjectAccess);
  const url = accessGateUrl ?? projectUrl ?? defaultUrl ?? "/";
  const queryParams =
    url === projectUrl && access ? { accessCode: access.code } : {};

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
    [navigateAway]
  );
};
