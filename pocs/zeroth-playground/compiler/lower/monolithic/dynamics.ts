import { assign, binary, ite, type LinearStatement, ref } from "../../graph/linear-graph";
import { type PlaceLayout, slotToken } from "../colour-layout";
import { refuse, within } from "../../diagnostics";
import {
  type LinearCodeEnv,
  scaled,
  type TokenBinding,
  type Translated,
  translateValue,
} from "../../code/linear-code";
import { attributeName, presentName } from "../names";
import { peelRootBindings } from "./root-bindings";

import type { CodeExpr, CodeFunction } from "../../code/code-tree";

/**
 * A place's dynamics as one Euler step per slot, before the sweep:
 * `x += f(x) * dt` on every real attribute of every present token. The equation's body is `tokens.map((token) => ({ attr:
 * derivative, ... }))`; a missing attribute has a zero derivative.
 */

export function lowerDynamics(
  layout: PlaceLayout,
  fn: CodeFunction,
  dt: number,
): LinearStatement[] {
  const inputName = fn.params[0]?.name ?? "tokens";
  const rootLocals = new Map<string, Translated | TokenBinding>();
  const env: LinearCodeEnv = {
    inputName,
    token: () => undefined,
    tokenCount: () => undefined,
  };
  const body = peelRootBindings(fn.body, env, rootLocals, "dynamics");
  // The callback may bind consts before its record; they are read per slot.
  let record = body.kind === "arrayMap" ? body.body : body;
  const callbackBindings: { name: string; value: CodeExpr }[] = [];
  while (record.kind === "let") {
    callbackBindings.push(...record.bindings);
    record = record.body;
  }
  if (
    body.kind !== "arrayMap" ||
    body.target.kind !== "localRef" ||
    body.target.name !== inputName ||
    record.kind !== "recordLit"
  ) {
    return refuse("dynamics-shape", "dynamics map the tokens to a record of derivatives");
  }
  const statements: LinearStatement[] = [];
  for (let slot = 0; slot < layout.slots; slot++) {
    const locals = new Map(rootLocals);
    locals.set(body.param.name, slotToken(layout, slot));
    for (const binding of callbackBindings) {
      locals.set(
        binding.name,
        within("dynamics", () => translateValue(binding.value, env, locals)),
      );
    }
    for (const attribute of layout.attributes) {
      if (!attribute.integrates) {
        continue;
      }
      const entry = record.entries.find((candidate) => candidate.key === attribute.name);
      if (entry === undefined) {
        continue;
      }
      const derivative = within("dynamics", () => translateValue(entry.value, env, locals));
      if (derivative.sort !== "number") {
        return refuse("sort-mismatch", `the derivative of ${attribute.name} is not a number`);
      }
      if (derivative.expr.kind === "num" && derivative.expr.value === 0) {
        // A zero derivative moves nothing.
        continue;
      }
      const variable = attributeName(layout.place, slot, attribute.name);
      statements.push(
        assign(
          variable,
          ite(
            ref(presentName(layout.place, slot)),
            binary("+", ref(variable), scaled(dt, derivative.expr)),
            ref(variable),
          ),
          slot === 0 ? `${layout.place}: one Euler step of dt = ${dt}` : undefined,
        ),
      );
    }
  }
  return statements;
}
