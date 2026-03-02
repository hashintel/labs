import { editor } from "monaco-editor";

import { configSchemas } from "./monaco-json";
import { configureJsCompletions } from "./monaco-js";
import { configurePythonCompletions } from "./monaco-python";
import { monacoTheme } from "./monaco-theme";

/**
 * Configures autocompletions and other settings that need to be run as initialization
 */
export function configureMonaco() {
  configSchemas();
  configureJsCompletions();
  configurePythonCompletions();

  editor.defineTheme("hash", monacoTheme as any);
}
export { globalConfigSchema } from "./schemas/globals";
