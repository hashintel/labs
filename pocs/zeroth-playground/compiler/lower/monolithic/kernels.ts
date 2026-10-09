import { assign, num, type LinearExpr, type LinearStatement, ref } from "../../graph/linear-graph";
import { refuse, within } from "../../diagnostics";
import {
  type LinearCodeEnv,
  resolveTokenExpr,
  type TokenBinding,
  type Translated,
  translateValue,
} from "../../code/linear-code";
import { outName } from "../names";
import { inputTokenCount } from "../step-plan";
import { peelRootBindings } from "./root-bindings";

import type { CodeExpr, CodeFunction } from "../../code/code-tree";
import type { PlaceLayout } from "../colour-layout";
import type { PlannedTransition, StepPlan } from "../step-plan";

/**
 * A kernel as per-token expressions: for each coloured output arc and each
 * of the `weight` tokens it produces, one local per attribute, computed in
 * the sweep from the bound tokens and the draws, and landed at the end of
 * the step by the compaction pass.
 */

export type ProducedTokens = {
  /** Per place, per produced token, the attribute values in layout order. */
  outs: Map<string, LinearExpr[][]>;
  statements: LinearStatement[];
};

type Locals = Map<string, Translated | TokenBinding>;

/** Peels the root `const` bindings into locals and returns the result record. */
function resultRecord(
  fn: CodeFunction,
  env: LinearCodeEnv,
  locals: Locals,
): Extract<CodeExpr, { kind: "recordLit" }> {
  const body = peelRootBindings(fn.body, env, locals, "kernel");
  if (body.kind !== "recordLit") {
    return refuse("kernel-output-shape", "a kernel returns a record keyed by output place");
  }
  return body;
}

/** The value written to one attribute of one produced token. */
function attributeWrite(
  layout: PlaceLayout,
  attribute: PlaceLayout["attributes"][number],
  token: CodeExpr | TokenBinding,
  env: LinearCodeEnv,
  locals: Locals,
): LinearExpr {
  if ("attribute" in token) {
    const value = token.attribute(attribute.name);
    if (value === undefined || "refused" in value) {
      return refuse(
        "kernel-attribute-missing",
        `the copied token has no ${attribute.name} the theories hold`,
      );
    }
    return value.expr;
  }
  if (token.kind !== "recordLit") {
    return refuse("kernel-output-shape", "a produced token is a record or a bound token");
  }
  const entry = token.entries.find((candidate) => candidate.key === attribute.name);
  if (entry === undefined) {
    return refuse(
      "kernel-attribute-missing",
      `the produced ${layout.colour} has no ${attribute.name}`,
    );
  }
  if (attribute.codes !== undefined) {
    if (entry.value.kind === "stringLit") {
      const code = attribute.codes.indexOf(entry.value.value);
      return code === -1
        ? refuse("string-code-unknown", `${entry.value.value} is not a value of ${attribute.name}`)
        : num(code);
    }
    const copied = within("kernel", () => translateValue(entry.value, env, locals));
    return copied.sort === "string"
      ? copied.expr
      : refuse("sort-mismatch", `${attribute.name} takes a string`);
  }
  const value = within("kernel", () => translateValue(entry.value, env, locals));
  const expected = attribute.sort === "bool" ? "boolean" : "number";
  return value.sort === expected
    ? value.expr
    : refuse(
        "sort-mismatch",
        `${attribute.name} takes a ${expected}, and the kernel writes a ${value.sort}`,
      );
}

export function lowerKernel(
  plan: StepPlan,
  transition: PlannedTransition,
  fn: CodeFunction,
  boundToken: (place: string, index: number) => TokenBinding | undefined,
  sample: LinearCodeEnv["sample"],
): ProducedTokens {
  const env: LinearCodeEnv = {
    inputName: fn.params[0]?.name ?? "input",
    token: boundToken,
    tokenCount: inputTokenCount(transition),
    sample,
  };
  const locals: Locals = new Map();
  const record = resultRecord(fn, env, locals);
  const outs = new Map<string, LinearExpr[][]>();
  const statements: LinearStatement[] = [];
  for (const [place, weight] of transition.produces) {
    const layout = plan.layouts.get(place);
    if (layout === undefined) {
      continue;
    }
    const entry = record.entries.find((candidate) => candidate.key === place);
    if (entry === undefined) {
      return refuse("kernel-output-missing", `the kernel writes nothing into ${place}`);
    }
    let tokens: (CodeExpr | TokenBinding)[];
    if (entry.value.kind === "arrayLit") {
      tokens = entry.value.elements.map(
        (element) => resolveTokenExpr(element, env, locals) ?? element,
      );
    } else {
      // A whole input place passed through: its bound tokens, in order.
      const source =
        entry.value.kind === "fieldAccess" &&
        entry.value.target.kind === "localRef" &&
        entry.value.target.name === env.inputName
          ? entry.value.field
          : undefined;
      const count = source === undefined ? undefined : env.tokenCount(source);
      if (source === undefined || count === undefined) {
        return refuse(
          "kernel-output-shape",
          `the tokens for ${place} are neither listed nor an input place passed through`,
        );
      }
      tokens = Array.from({ length: count }, (_, index) => {
        const token = boundToken(source, index);
        return token ?? refuse("kernel-output-shape", `${source} is not a bound input`);
      });
    }
    if (tokens.length !== weight) {
      return refuse(
        "kernel-output-count",
        `${place} receives ${tokens.length} tokens from the kernel and ${weight} from the arc`,
      );
    }
    const produced: LinearExpr[][] = [];
    tokens.forEach((token, index) => {
      const values = layout.attributes.map((attribute) => {
        const name = outName(transition.name, place, index, attribute.name);
        statements.push(assign(name, attributeWrite(layout, attribute, token, env, locals)));
        return ref(name);
      });
      produced.push(values);
    });
    outs.set(place, produced);
  }
  return { outs, statements };
}
