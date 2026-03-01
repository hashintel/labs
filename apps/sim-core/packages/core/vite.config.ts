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

  return {
    root: ".",
    plugins: [
      react(),
      wasm(),
      topLevelAwait(),
      monacoEditorPlugin({
        languageWorkers: ["editorWorkerService", "json", "typescript"],
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
      PUBLIC_PATH: JSON.stringify("/"),
      BUILD_STAMP: JSON.stringify(buildStamp),
      LOCAL_API: JSON.stringify(true),
      MAPBOX_API_TOKEN: JSON.stringify(process.env.MAPBOX_API_TOKEN ?? null),
      // Polyfill Node.js globals that Webpack 4 provided automatically
      global: "globalThis",
    },
    css: {
      preprocessorOptions: {
        scss: {
          silenceDeprecations: [
            "color-functions",
            "global-builtin",
            "slash-div",
          ],
        },
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
      reportCompressedSize: false,
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        // Rollup's native tree-shaking crashes on Windows (NAPI module fault
        // during recursive module-graph walk with 7100+ modules and deep
        // circular dependencies in @msrvida/sanddance-explorer, @fluentui,
        // office-ui-fabric-react, etc.). esbuild minification still performs
        // expression-level dead-code elimination.
        treeshake: false,
        input: {
          main: path.resolve(__dirname, "index.html"),
          embed: path.resolve(__dirname, "embed.html"),
        },
        onLog(level, log) {
          if (log.code === "CIRCULAR_DEPENDENCY") return;
          if (log.message?.includes("__vite-browser-external")) return;
        },
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/monaco-editor/")) return "vendor-monaco";
            if (id.includes("node_modules/three/") || id.includes("node_modules/three-stdlib/") || id.includes("node_modules/@react-three/")) return "vendor-three";
            if (id.includes("node_modules/plotly.js") || id.includes("node_modules/react-plotly")) return "vendor-plotly";
            if (id.includes("node_modules/@deck.gl/") || id.includes("node_modules/@luma.gl/") || id.includes("node_modules/@loaders.gl/") || id.includes("node_modules/mapbox-gl") || id.includes("node_modules/react-mapbox-gl")) return "vendor-geo";
            if (id.includes("node_modules/@fluentui/") || id.includes("node_modules/office-ui-fabric-react/") || id.includes("node_modules/@uifabric/") || id.includes("node_modules/@microsoft/load-themed-styles")) return "vendor-fluentui";
            if (id.includes("node_modules/@msrvida/") || id.includes("node_modules/vega")) return "vendor-sanddance";
            if (id.includes("node_modules/d3")) return "vendor-d3";
            if (id.includes("node_modules/lodash")) return "vendor-lodash";
          },
        },
      },
    },
    optimizeDeps: {
      exclude: [
        "@hashintel/engine-web",
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
        "@react-three/fiber",
        "@react-three/drei",
        "bowser",
        "jstat",
        "mapbox-gl",
        "@turf/bbox",
        "@turf/helpers",
        "promise-worker-transferable",
        "promise-worker-transferable/register",
        "react-shepherd",
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
