import { type Example, FIRST_EXAMPLE, exampleById } from "../../examples/catalog";

/** The two views: the examples workspace, or how the compiler works. */
export type View = "examples" | "compiler";

/** What the playground opens on. */
export type Route = { view: View; example: Example };

/**
 * What a URL hash names, so a link opens the playground on it: `#capacity`
 * is an example, `#compiler` the Compiler view, `#compiler/capacity` both. An
 * example the catalog does not hold opens the first one.
 */
export function routeOf(hash: string): Route {
  const [first = "", second = ""] = hash.replace(/^#/u, "").split("/");
  return first === "compiler"
    ? { view: "compiler", example: exampleById(second) ?? FIRST_EXAMPLE }
    : { view: "examples", example: exampleById(first) ?? FIRST_EXAMPLE };
}
