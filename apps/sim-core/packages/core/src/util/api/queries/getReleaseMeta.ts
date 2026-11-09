import type { ReleaseMeta } from "../types";

/**
 * Local-first: returns empty release metadata (no server call).
 */
export const getReleaseMeta = (): Promise<ReleaseMeta> =>
  Promise.resolve({
    keywords: [],
    licenses: [],
    subjects: undefined,
  });
