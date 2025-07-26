import { editor } from "monaco-editor";

import { configSchemas } from "./monaco-json";
import { configureJsCompletions } from "./monaco-js";
import { monacoTheme } from "./monaco-theme";

/**
 * Configures autocompletions and other settings that need to be run as initialization
 */
export function configureMonaco() {
  // Configures monaco to autocomplete the JSON files
  configSchemas();

  // Configures monaco to autocomplete JS files
  configureJsCompletions();

  editor.defineTheme("hash", monacoTheme as any);
}
export { globalConfigSchema } from "./schemas/globals";
