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
        // Force CJS build: the ESM build (lib-esm) has mixed require() calls
        // and assigns to the mapbox-gl namespace import, both invalid in ESM.
        // CJS uses __importStar which creates a writable object, so the
        // accessToken assignment works and esbuild can pre-bundle it cleanly.
        "react-mapbox-gl": "react-mapbox-gl/lib/index.js",
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
    preview: {
      port: 8080,
      // Match dev server port so E2E can use same baseURL for build+preview
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
        // drei must go through Vite transform (not esbuild optimizer)
        // so the fix-drei-stats plugin can rewrite its stats.min import
        "drei",
        // react-plotly.js main entry pulls in all of plotly.js at module
        // scope. Source files use the factory pattern with plotly.js-dist-min
        // instead (the officially recommended Vite-compatible approach).
        "react-plotly.js",
      ],
      include: [
        // Pre-bundle deps upfront so esbuild handles CJS↔ESM conversion
        // and avoids mid-session discovery that triggers page reloads.
        "react-mapbox-gl",
        "deep-equal",
        "react-plotly.js/factory",
        "plotly.js-dist-min",
        "lodash.omit",
        "lodash.pick",
        "stats.js",
        "bowser",
        "jstat",
        "mapbox-gl",
        "@turf/bbox",
        "@turf/helpers",
        "promise-worker-transferable",
        "promise-worker-transferable/register",
        "recoil",
        "react-three-fiber",
        "react-shepherd",
        "@reduxjs/toolkit",
        "react-redux",
        "rxjs",
        "immer",
        "@fluentui/react",
        "simplebar-react",
        "react-splitter-layout",
        "react-tabs",
        "react-transition-group",
        "react-select",
        "react-dropzone",
        "react-hook-form",
        "react-intersection-observer",
        "monaco-editor",
        "classnames",
        "date-fns",
        "uuid",
        "lodash-es",
        "jszip",
        "file-saver",
        "url-join",
      ],
    },
    worker: {
      plugins: () => [wasm(), topLevelAwait()],
    },
  };
});
