import { within } from "../../diagnostics";
import {
  type LinearCodeEnv,
  resolveTokenExpr,
  type TokenBinding,
  type Translated,
  translateValue,
} from "../../code/linear-code";

import type { CodeExpr } from "../../code/code-tree";

/**
 * Peels the `const` bindings at the root of a kernel or dynamics body into
 * `locals`, a bound token as itself and anything else translated, and
 * returns the expression under them.
 */
export function peelRootBindings(
  body: CodeExpr,
  env: LinearCodeEnv,
  locals: Map<string, Translated | TokenBinding>,
  surface: "kernel" | "dynamics",
): CodeExpr {
  let rest = body;
  while (rest.kind === "let") {
    for (const binding of rest.bindings) {
      locals.set(
        binding.name,
        resolveTokenExpr(binding.value, env, locals) ??
          within(surface, () => translateValue(binding.value, env, locals)),
      );
    }
    rest = rest.body;
  }
  return rest;
}
