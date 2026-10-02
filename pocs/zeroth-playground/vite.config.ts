/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";

import mdx from "@mdx-js/rollup";
import react from "@vitejs/plugin-react";
import rehypeMathjax from "rehype-mathjax/svg";
import remarkMath from "remark-math";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // index.html lives in playground/; compiler/ and examples/ are imported from there.
  root: fromRoot("./playground"),
  build: {
    // The one-file build stays at dist/index.html, beside package.json.
    outDir: fromRoot("./dist"),
    emptyOutDir: true,
  },
  plugins: [
    // Math in the pages is rendered to inline SVG at build time: no fonts or stylesheet to ship.
    // Only .mdx files are pages, so a .md file imported with ?raw stays text.
    {
      enforce: "pre",
      ...mdx({ include: /\.mdx$/u, remarkPlugins: [remarkMath], rehypePlugins: [rehypeMathjax] }),
    },
    // The React Compiler, in its Rust port, memoizes components and hooks, so the code derives
    // values in render and keeps effects for the systems React does not own.
    react({
      compiler: {
        // Every diagnostic fails the build, bailouts included, so no component is left
        // unmemoized without anyone noticing.
        panicThreshold: "all_errors",
        // oxc-transform-react leaves recoverable diagnostics out unless asked.
        reportDiagnostics: true,
        logDiagnostics: true,
        // Compile a "use no memo" function too. A diagnostic in one is logged, not fatal.
        ignoreUseNoForget: true,
        // Stricter checks: no Date.now() or Math.random() in render, no effect that only
        // derives state, and a manual memo that lists all its dependencies and returns a value.
        environment: {
          validateNoImpureFunctionsInRender: true,
          validateNoDerivedComputationsInEffects: true,
          validateExhaustiveMemoizationDependencies: true,
          validateNoVoidUseMemo: true,
        },
      },
    }),
    // One HTML file: JS, CSS, fonts and the editor worker inlined, so it opens from disk.
    viteSingleFile({ removeViteModuleLoader: true }),
  ],
  test: {
    // Vitest's root defaults to Vite's root, playground/: widen it to the project.
    root: fromRoot("."),
    include: ["{compiler,examples,playground}/**/*.test.{ts,tsx}"],
  },
});
