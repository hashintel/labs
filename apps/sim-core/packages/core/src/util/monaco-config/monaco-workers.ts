/**
 * Configure Monaco's web workers using Vite's native URL-based worker imports.
 * Must be called before any Monaco editor instance is created.
 *
 * Uses `new URL(..., import.meta.url)` so that Vite emits the worker as a
 * separate chunk without routing it through the worker.plugins pipeline
 * (which includes vite-plugin-top-level-await / vite-plugin-wasm that only
 * apply to the simulation WASM worker).
 */
export function configureMonacoWorkers() {
  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === "json") {
        return new Worker(
          new URL(
            "monaco-editor/esm/vs/language/json/json.worker.js",
            import.meta.url,
          ),
          { type: "module" },
        );
      }
      if (label === "typescript" || label === "javascript") {
        return new Worker(
          new URL(
            "monaco-editor/esm/vs/language/typescript/ts.worker.js",
            import.meta.url,
          ),
          { type: "module" },
        );
      }
      return new Worker(
        new URL(
          "monaco-editor/esm/vs/editor/editor.worker.js",
          import.meta.url,
        ),
        { type: "module" },
      );
    },
  };
}
