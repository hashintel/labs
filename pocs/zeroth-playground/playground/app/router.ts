import { useSyncExternalStore } from "react";

import { type Route, hashOf, routeOf } from "./route";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readHash(): string {
  return window.location.hash;
}

/**
 * The route the address bar names, kept in step with it: a link to a hash,
 * `navigate`, and the browser's Back and Forward all change the hash, and the
 * app renders the route it names. The hash is the one source of where the
 * app is, so every link is an ordinary `<a href="#…">`.
 */
export function useRoute(): Route {
  return routeOf(useSyncExternalStore(subscribe, readHash));
}

/** Goes to a route the way a link would: a new history entry, then a render of the route. */
export function navigate(route: Route): void {
  window.location.hash = hashOf(route);
}
