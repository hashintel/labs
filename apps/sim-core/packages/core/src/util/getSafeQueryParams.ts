import { memoize } from "lodash";

const memoizedSafeGetQueryParams = memoize((search: string) =>
  Object.fromEntries(new URLSearchParams(search)),
);

/**
 * getQueryParams in hook router is broken because it never reparses the query
 * string when the URL changes – and assumes it is only ever changed by
 * hookrouter – this is not correct as it can be changed by the back/forward
 * button.
 */
export const getSafeQueryParams = () =>
  memoizedSafeGetQueryParams(window.location.search);
