import { type Example, FIRST_EXAMPLE, exampleById } from "../../examples/catalog";
import { type Question, questionById } from "../../semantics/register";

/** The three views: the Playground, how the compiler works, and the questions on the semantics. */
export type View = "playground" | "compiler" | "semantics";

/** What the playground opens on; `question` only when the hash selects one in the Semantics view. */
export type Route = { view: View; example: Example; question?: Question };

/**
 * What a URL hash names, so a link opens the playground on it: `#capacity`
 * is an example, `#compiler` the Compiler view, `#compiler/capacity` both,
 * `#semantics` the Semantics view and `#semantics/ties-under-clocks` one of
 * its questions. An example the catalog does not hold opens the first one,
 * and a question the register does not hold opens the view with none.
 */
export function routeOf(hash: string): Route {
  const [first = "", second = ""] = hash.replace(/^#/u, "").split("/");
  if (first === "compiler") {
    return { view: "compiler", example: exampleById(second) ?? FIRST_EXAMPLE };
  }
  if (first === "semantics") {
    const question = questionById(second);
    return { view: "semantics", example: FIRST_EXAMPLE, ...(question === undefined ? {} : { question }) };
  }
  return { view: "playground", example: exampleById(first) ?? FIRST_EXAMPLE };
}
