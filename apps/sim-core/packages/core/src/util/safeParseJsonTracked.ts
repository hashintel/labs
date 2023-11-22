import { Json } from "@hashintel/engine-web";

import { ParsedAnalysis, ParsedGlobals } from "../features/files/types";
import { getErrorMessage } from "../features/utils";

// type SafeParseJsonTrackedReturn<T> = () => T;

export const safeParseJsonTracked = <T extends ParsedAnalysis | ParsedGlobals>(
  inputString?: string | null,
): {
  lastInputString: null | string;
  parsed: null | T | Json;
  error: string | null;
} => {
  if (!inputString) {
    return { lastInputString: null, parsed: null, error: null };
  }
  let error = null;
  let parsed = null;

  try {
    parsed = JSON.parse(inputString);
  } catch (err) {
    error = getErrorMessage(err);
    parsed = null;
  }
  return {
    lastInputString: inputString,
    parsed,
    error,
  };
};
