import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import monacoEditorPlugin from "vite-plugin-monaco-editor-esm";
import path from "path";

export default defineConfig(({ mode }) => {
  const isProduction = mode === "production";
  const buildStamp = [
    "hash",
    isProduction ? "prod" : "dev",
    new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-T")
      .slice(0, 20),
  ].join("-");

  // Plugin to fix drei's `import * as StatsImpl from 'three/examples/js/libs/stats.min'`
  // then `new StatsImpl()`. The `import *` creates a namespace object, not a constructor.
  // We rewrite it to `import StatsImpl from 'stats.js'` which gives the default export.
  const fixDreiStats = {
    name: "fix-drei-stats",
    transform(code: string, id: string) {
      if (id.includes("drei")) {
        return code
          .replace(
            /import\s*\*\s*as\s+StatsImpl\s+from\s*['"]three\/examples\/js\/libs\/stats\.min['"]/g,
            'import StatsImpl from "stats.js"'
          );
      }
    },
  };

  return {
    root: ".",
    plugins: [
      fixDreiStats,
      react(),
      wasm(),
      topLevelAwait(),
      monacoEditorPlugin({
        languageWorkers: [
          "editorWorkerService",
          "json",
          "typescript",
        ],
      }),
    ],
    resolve: {
      alias: {
        lodash: "lodash-es",
        "lodash.omit": "lodash-es/omit",
        "lodash.pick": "lodash-es/pick",
        "@juggle/resize-observer$": "empty-module",
      },
    },
    define: {
      WEBPACK_PUBLIC_PATH: JSON.stringify("/"),
      WEBPACK_BUILD_STAMP: JSON.stringify(buildStamp),
      LOCAL_API: JSON.stringify(true),
      MAPBOX_API_TOKEN: JSON.stringify(
        process.env.MAPBOX_API_TOKEN ?? null
      ),
      // Polyfill Node.js globals that Webpack 4 provided automatically
      global: "globalThis",
    },
    css: {
      preprocessorOptions: {
        scss: {},
      },
    },
    server: {
      port: 8080,
      // SPA fallback — equivalent to webpack historyApiFallback
      // Vite does this automatically for the dev server
    },
    build: {
      outDir: "dist",
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "index.html"),
          embed: path.resolve(__dirname, "embed.html"),
        },
      },
    },
    optimizeDeps: {
      exclude: [
        "@hashintel/engine-web",
        // react-mapbox-gl has invalid ESM: assigns to mapbox-gl import
        "react-mapbox-gl",
      ],
      include: [
        // Force CJS→ESM conversion for libraries with issues
        "plotly.js",
        "stats.js",
      ],
    },
    worker: {
      plugins: () => [wasm(), topLevelAwait()],
    },
  };
});
