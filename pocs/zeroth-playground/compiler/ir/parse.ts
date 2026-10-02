import { YAMLException, load } from "js-yaml";
import type { z } from "zod";

import { isDiagnosticCode } from "../diagnostics";
import { itemAtPath, netItem } from "./net-item";
import { petriNetIrSchema } from "./schema";
import { yamlKeys } from "./yaml-keys";

import type { Diagnostic, DiagnosticCode } from "../diagnostics";
import type { PetriNetIr } from "./schema";

export type ParseOutcome = { ok: true; ir: PetriNetIr } | { ok: false; errors: Diagnostic[] };

/** The code a reference check gives its issue, or `schema` for a shape issue. */
function issueCode(issue: z.core.$ZodIssue): DiagnosticCode {
  return issue.code === "custom" && isDiagnosticCode(issue.params?.code)
    ? issue.params.code
    : "schema";
}

/** A record key that fails its pattern is reported through the key's own message. */
function issueMessage(issue: z.core.$ZodIssue): string {
  return issue.code === "invalid_key" && issue.issues.length > 0
    ? issue.issues.map((inner) => inner.message).join("; ")
    : issue.message;
}

function yamlError(error: YAMLException): Diagnostic {
  return {
    code: "yaml-syntax",
    message: error.reason,
    item: netItem("document"),
    ...(error.mark === undefined ? {} : { line: error.mark.line + 1 }),
  };
}

/**
 * Reads an IR document: YAML first, then the schema, then the references
 * between its sections. Every issue is one diagnostic at the line of the key
 * it concerns, so a reader fixes them all in one pass. The references are
 * checked once the shape is right.
 */
export function parsePetriNetIr(text: string): ParseOutcome {
  let loaded: unknown;
  try {
    loaded = load(text);
  } catch (error) {
    if (error instanceof YAMLException) {
      return { ok: false, errors: [yamlError(error)] };
    }
    throw error;
  }
  const result = petriNetIrSchema.safeParse(loaded);
  if (result.success) {
    return { ok: true, ir: result.data };
  }
  // A path met twice, such as a key in each item of a list, takes its last line.
  const lines = new Map(yamlKeys(text).map((key) => [key.path.join("."), key.line]));
  return {
    ok: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.map(String).join(".");
      const line = lines.get(path);
      const message = issueMessage(issue);
      return {
        code: issueCode(issue),
        message: path === "" ? message : `${path}: ${message}`,
        item: itemAtPath(issue.path),
        ...(line === undefined ? {} : { line }),
      };
    }),
  };
}
