/**
 * Lets plain Node run the compiler's TypeScript: a relative import written
 * without an extension, as the compiler writes them for Vite, resolves to its
 * `.ts` file. Preload it with `node --import ./compiler/scripts/resolve-ts.ts`.
 */
import { registerHooks } from "node:module";

const RELATIVE = /^\.\.?\//u;
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/u;

registerHooks({
  resolve(specifier, context, nextResolve) {
    return RELATIVE.test(specifier) && !HAS_EXTENSION.test(specifier)
      ? nextResolve(`${specifier}.ts`, context)
      : nextResolve(specifier, context);
  },
});
