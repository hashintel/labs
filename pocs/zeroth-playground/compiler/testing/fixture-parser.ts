import CODE_TREES from "./code-trees.json";

import type { CodeFunction } from "../code/code-tree";
import type { CodeSurface } from "../code/code-tree";

/**
 * The trees a TypeScript parser made of every code string the tests use,
 * captured once with constants folded. They carry no ids, spans or surface,
 * which nothing in the compiler reads.
 */
const TREES = CODE_TREES as unknown as Record<
  CodeSurface,
  Record<string, CodeFunction | undefined>
>;

/**
 * A code parser for tests: it looks the code string up instead of parsing
 * it. A string with no captured tree fails the test, so a new code string
 * needs its tree added to code-trees.json.
 */
export function parseCode(code: string, surface: CodeSurface): CodeFunction {
  const tree = TREES[surface][code];
  if (tree === undefined) {
    throw new Error(`no ${surface} tree is captured for ${JSON.stringify(code)}`);
  }
  return tree;
}
