/**
 * Lightweight route matching hook - replaces hookrouter's useRoutes.
 * Matches the current URL path against a map of route patterns and
 * returns the corresponding React element.
 *
 * Re-renders when the URL changes (via navigate/setQueryParams or popstate).
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { subscribeToNavigation } from "./navigation";

type RouteHandler = (params: any) => any;
export type RouteMap = Record<string, RouteHandler>;

const matchRoute = (
  pattern: string,
  pathname: string,
): Record<string, string> | null => {
  if (pattern === "*") {
    return {};
  }

  // Wildcard suffix match: "/@*" matches "/@hash/foo/main"
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    if (pathname.startsWith(prefix)) {
      return { "*": pathname.slice(prefix.length) };
    }
    return null;
  }

  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");

  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let idx = 0; idx < patternParts.length; idx++) {
    const pp = patternParts[idx];
    const pathPart = pathParts[idx];

    if (pp.startsWith(":")) {
      params[pp.slice(1)] = decodeURIComponent(pathPart);
    } else if (pp !== pathPart) {
      // Handle prefix+param patterns like "@:namespace" → match "@hash"
      const colonIdx = pp.indexOf(":");
      if (colonIdx > 0) {
        const prefix = pp.slice(0, colonIdx);
        const paramName = pp.slice(colonIdx + 1);
        if (pathPart.startsWith(prefix)) {
          params[paramName] = decodeURIComponent(pathPart.slice(prefix.length));
        } else {
          return null;
        }
      } else {
        return null;
      }
    }
  }

  return params;
};

const getPathname = () => window.location.pathname;

export const usePathRouter = (routes: RouteMap): any | null => {
  const [pathname, setPathname] = useState(getPathname);

  const update = useCallback(() => {
    setPathname(getPathname());
  }, []);

  useEffect(() => {
    window.addEventListener("popstate", update);
    const unsubscribe = subscribeToNavigation(update);

    return () => {
      window.removeEventListener("popstate", update);
      unsubscribe();
    };
  }, [update]);

  return useMemo(() => {
    const entries = Object.entries(routes);

    for (const [pattern, handler] of entries) {
      const params = matchRoute(pattern, pathname);
      if (params !== null) {
        return handler(params);
      }
    }

    return null;
  }, [routes, pathname]);
};
