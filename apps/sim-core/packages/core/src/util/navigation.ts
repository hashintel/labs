/**
 * Navigation utilities - centralizes programmatic navigation.
 * Replaces hookrouter's navigate/setQueryParams with
 * a thin wrapper that works both inside and outside React components.
 */

type NavigateListener = () => void;
const listeners: NavigateListener[] = [];

export const subscribeToNavigation = (listener: NavigateListener) => {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
};

const notifyListeners = () => {
  for (const listener of listeners) {
    listener();
  }
};

/**
 * Programmatic navigation.
 * Can be called from React components, Redux thunks, or any other code.
 *
 * @param url - The URL path to navigate to
 * @param replace - Whether to replace the current history entry (default: false)
 * @param queryParams - Query parameters to include
 * @param addToPath - If true, append queryParams to the URL. If false (default), handle as state
 */
export const navigate = (
  url: string,
  replace = false,
  queryParams: Record<string, string | boolean | undefined> = {},
  addToPath = false
) => {
  const filteredParams = Object.fromEntries(
    Object.entries(queryParams)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)])
  ) as Record<string, string>;

  let fullUrl = url;
  if (addToPath && Object.keys(filteredParams).length > 0) {
    const search = new URLSearchParams(filteredParams).toString();
    fullUrl = `${url}${url.includes("?") ? "&" : "?"}${search}`;
  } else if (!addToPath && Object.keys(filteredParams).length > 0) {
    const search = new URLSearchParams(filteredParams).toString();
    fullUrl = `${url}${url.includes("?") ? "&" : "?"}${search}`;
  }

  if (replace) {
    window.history.replaceState(null, "", fullUrl);
  } else {
    window.history.pushState(null, "", fullUrl);
  }

  notifyListeners();
};

/**
 * Update query parameters on the current URL.
 *
 * @param params - Parameters to set. Undefined values remove the parameter.
 * @param replace - Whether to replace the current history entry (default: false)
 */
export const setQueryParams = (
  params: Record<string, string | undefined>,
  replace = false
) => {
  const searchParams = new URLSearchParams(window.location.search);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      searchParams.delete(key);
    } else {
      searchParams.set(key, value);
    }
  }

  const search = searchParams.toString();
  const newUrl = `${window.location.pathname}${search ? `?${search}` : ""}`;

  if (replace) {
    window.history.replaceState(null, "", newUrl);
  } else {
    window.history.pushState(null, "", newUrl);
  }

  notifyListeners();
};
