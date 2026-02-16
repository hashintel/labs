import { useCallback, useEffect, useReducer } from "react";

import { getSafeQueryParams } from "../util/getSafeQueryParams";
import {
  setQueryParams as navSetQueryParams,
  subscribeToNavigation,
} from "../util/navigation";

export const useSafeQueryParams = () => {
  const [, forceRender] = useReducer((sum) => sum + 1, 0);

  useEffect(() => {
    const handler = () => {
      forceRender();
    };

    window.addEventListener("popstate", handler);
    const unsubscribe = subscribeToNavigation(handler);

    return () => {
      window.removeEventListener("popstate", handler);
      unsubscribe();
    };
  }, []);

  const setQueryParams = useCallback(
    (params: Record<string, string | undefined>, replace = false) => {
      navSetQueryParams(params, replace);
    },
    []
  );

  return [getSafeQueryParams(), setQueryParams] as const;
};
