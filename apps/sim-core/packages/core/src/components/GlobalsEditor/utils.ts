import { JSONSchema7 } from "json-schema";
import { Json } from "@hashintel/engine-web";

import { ParsedGlobals } from "../../features/files/types";
import { safeParseJsonTracked } from "../../util/safeParseJsonTracked";

export const getChildSchema = <T extends JSONSchema7 | undefined>(
  value: T | boolean,
): T | undefined => (typeof value === "boolean" ? undefined : value);

export const parseNumber = (
  value: string | number,
  schemaType: JSONSchema7["type"] | undefined,
): string | number => {
  if (typeof value === "string" && schemaType !== "string") {
    const parsed = parseFloat(value);

    if (!isNaN(parsed)) {
      return parsed;
    }
  }

  return value;
};

export const parseGlobals = (
  globalsString?: string | null,
): {
  lastGlobalsString: null | string;
  globals: null | ParsedGlobals | Json;
  error: string | null;
} => {
  if (!globalsString) {
    return { lastGlobalsString: null, globals: null, error: null };
  }

  const result = safeParseJsonTracked<ParsedGlobals>(globalsString);
  return {
    lastGlobalsString: globalsString,
    globals: result.parsed,
    error: result.error,
  };
};
