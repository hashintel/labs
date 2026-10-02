import { OPTIONS, OPTION_NAMES } from "../../compiler";
import { type Example, exampleById } from "../../examples/catalog";
import { type Question, questionById } from "../../semantics/register";

import type { CompilerOptions, OptionSpec } from "../../compiler";

/** The three views: the Playground, how the compiler works, and the questions on the semantics. */
export type View = "playground" | "compiler" | "semantics";

/**
 * What a URL hash names. The Playground and Compiler views work on an example,
 * under the options the hash carries in place of the ones it opens with; a
 * hash that names no example, or one the catalog does not hold, leaves the
 * open example as it is. The Semantics view may select a question.
 */
export type Route =
  | { view: "playground" | "compiler"; example?: Example; options?: CompilerOptions }
  | { view: "semantics"; question?: Question };

/** The options a hash's query names, each checked against the options table. */
function optionsOf(query: string): CompilerOptions | undefined {
  const params = new URLSearchParams(query);
  const options: Partial<Record<keyof CompilerOptions, string | number>> = {};
  for (const name of OPTION_NAMES) {
    const text = params.get(name);
    if (text === null) {
      continue;
    }
    const { values }: OptionSpec = OPTIONS[name];
    if (values === null) {
      const number = Number(text);
      if (Number.isFinite(number) && number > 0) {
        options[name] = number;
      }
    } else if (values.includes(text)) {
      options[name] = text;
    }
  }
  // Every value above is one the table allows for its option.
  return Object.keys(options).length === 0 ? undefined : (options as CompilerOptions);
}

/** The query naming the options, in the table's order; none for no options. */
function queryOf(options: CompilerOptions | undefined): string {
  const params = new URLSearchParams();
  for (const name of OPTION_NAMES) {
    const value = options?.[name];
    if (value !== undefined) {
      params.set(name, String(value));
    }
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

/**
 * The route a hash names: `#capacity` is an example, `#capacity?shape=modular`
 * one under other options, `#compiler/capacity` the Compiler view on it,
 * `#semantics` the Semantics view and `#semantics/ties-under-clocks` one of
 * its questions.
 */
export function routeOf(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#/u, "").split("?");
  const [first = "", second = ""] = path.split("/");
  if (first === "semantics") {
    const question = questionById(second);
    return { view: "semantics", ...(question === undefined ? {} : { question }) };
  }
  const view = first === "compiler" ? "compiler" : "playground";
  const example = exampleById(view === "compiler" ? second : first);
  const options = optionsOf(query);
  return {
    view,
    ...(example === undefined ? {} : { example }),
    ...(options === undefined ? {} : { options }),
  };
}

/** The hash naming a route, so that `routeOf(hashOf(route))` is `route`. */
export function hashOf(route: Route): string {
  if (route.view === "semantics") {
    return route.question === undefined ? "#semantics" : `#semantics/${route.question.id}`;
  }
  const example = route.example?.id ?? "";
  const path = route.view === "compiler" ? `compiler/${example}` : example;
  return `#${path}${queryOf(route.options)}`;
}
