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
        // react-mapbox-gl assigns to an ES import (mapbox-gl.accessToken)
        // which esbuild's dep optimizer rejects as invalid ESM
        "react-mapbox-gl",
      ],
    },
    worker: {
      plugins: () => [wasm(), topLevelAwait()],
    },
  };
});
