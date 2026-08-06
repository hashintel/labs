import { editor } from "monaco-editor";

import { configSchemas } from "./monaco-json";
import { configureJsCompletions } from "./monaco-js";
import { configurePythonCompletions } from "./monaco-python";
import { monacoTheme } from "./monaco-theme";
import { configureMonacoWorkers } from "./monaco-workers";

/**
 * Configures autocompletions and other settings that need to be run as initialization.
 * Worker setup must happen before any editor is created.
 */
export function configureMonaco() {
  configureMonacoWorkers();
  configSchemas();
  configureJsCompletions();
  configurePythonCompletions();

  editor.defineTheme("hash", monacoTheme as any);
}
export { globalConfigSchema } from "./schemas/globals";
