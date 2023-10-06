import { useEffect, useReducer } from "react";
import { useQueryParams } from "hookrouter";

import { getSafeQueryParams } from "../util/getSafeQueryParams";

export const useSafeQueryParams = () => {
  /**
   * Using this instead of just the global export to ensure we're re-rendering
   * when hookrouter sets query params
   */
  const [, setQueryParams] = useQueryParams();
  const [, forceRender] = useReducer((sum) => sum + 1, 0);

  // Ensure we re-render when users navigate forward/backward
  useEffect(() => {
    const handler = () => {
      forceRender();
    };
    window.addEventListener("popstate", handler);

    return () => {
      window.removeEventListener("popstate", handler);
    };
  }, []);

  return [getSafeQueryParams(), setQueryParams] as const;
};
