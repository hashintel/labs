import { type Example, exampleById } from "../../examples/catalog";

/**
 * What a URL hash names: an example, or none, and which flags are on: MTL
 * (time windows) and nested operators (full LTL). A hash that names no
 * example, or one the catalog does not hold, leaves the open example as it
 * is. An example that needs a flag turns it on.
 */
export type Route = { example?: Example; mtl: boolean; nested: boolean };

/** The route a hash names: `#queue-always` is an example, `#oven-hot-window?mtl=1` one with MTL on, `#heater-settles?nested=1&mtl=1` both flags. */
export function routeOf(hash: string): Route {
  const [id = "", query = ""] = hash.replace(/^#/u, "").split("?");
  const example = exampleById(id);
  const params = new URLSearchParams(query);
  const mtl = params.get("mtl") === "1" || example?.mtl === true;
  const nested = params.get("nested") === "1" || example?.nested === true;
  return example === undefined ? { mtl, nested } : { example, mtl, nested };
}

/** The hash naming a route, so that `routeOf(hashOf(route))` is `route`. Flags that are on follow as a query, nested first. */
export function hashOf(route: Route): string {
  const flags = [route.nested ? "nested=1" : "", route.mtl ? "mtl=1" : ""].filter((flag) => flag !== "");
  return `#${route.example?.id ?? ""}${flags.length === 0 ? "" : `?${flags.join("&")}`}`;
}
