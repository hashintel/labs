/**
 * Monaco, bundled from npm: the tree-shakeable `editor.api` entry plus the
 * features and grammars the two editors use, never the CDN. The editor
 * worker is inlined by Vite so the single file needs no worker file beside
 * it; neither grammar needs a language worker.
 */
import * as monaco from "monaco-editor/editor/editor.api.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker&inline";
// The suggest feature entry loads inline completions alone; the widget is its controller.
import "monaco-editor/editor/contrib/suggest/browser/suggestController.js";
import "monaco-editor/features/folding/register.js";
import "monaco-editor/features/hover/register.js";
import "monaco-editor/features/stickyScroll/register.js";
import "monaco-editor/languages/definitions/python/register.js";

import { registerPetriNetIrLanguage } from "./petri-net-ir-language";
import { registerProvenanceHover } from "./provenance-hover";
import { defineSwissTheme } from "./swiss-theme";

globalThis.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

declare global {
  /** The providers the last run of this module registered on the shared Monaco. */
  var playgroundMonacoProviders: monaco.IDisposable[] | undefined;
}

// A hot update in development runs this module again against the same Monaco: dispose the
// providers of the previous run, or every hover card and completion list would show twice.
for (const provider of globalThis.playgroundMonacoProviders ?? []) {
  provider.dispose();
}
defineSwissTheme(monaco);
globalThis.playgroundMonacoProviders = [
  ...registerPetriNetIrLanguage(monaco),
  ...registerProvenanceHover(monaco),
];

export { monaco };
export type Monaco = typeof monaco;
