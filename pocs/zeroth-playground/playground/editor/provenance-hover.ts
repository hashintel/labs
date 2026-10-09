import { itemLabel, provenanceAt } from "../../compiler";
import { PETRI_NET_IR_LANGUAGE } from "./petri-net-ir-language";

import type { Provenance, Trace } from "../../compiler";
import type { IDisposable, editor, languages } from "monaco-editor/editor/editor.api.js";
import type { Monaco } from "./monaco";

/**
 * The hover behind both editors: a provider that reads the trace bound to
 * the model under the pointer and shows the record of the innermost range
 * holding the line.
 */

/** Monaco's own id for the grammar of the module editor. */
const PYTHON_LANGUAGE = "python";

type TraceBinding = {
  trace: Trace;
  /** The text the trace was built for; a model showing other text gets no hover. */
  text: string;
};

// One binding per model, read by the provider at hover time.
const bindings = new Map<string, TraceBinding>();

export function bindTrace(modelUri: string, binding: TraceBinding): void {
  bindings.set(modelUri, binding);
}

export function unbindTrace(modelUri: string): void {
  bindings.delete(modelUri);
}

function traceOf(model: editor.ITextModel): Trace | null {
  const binding = bindings.get(model.uri.toString());
  return binding === undefined || binding.text !== model.getValue() ? null : binding.trace;
}

/** The hover card's markdown: what, why, then where it comes from. */
function provenanceMarkdown(provenance: Provenance): string {
  const lines = [`**${provenance.what}**`];
  if (provenance.why !== undefined && provenance.why !== "") {
    lines.push("", provenance.why);
  }
  const sources = [
    ...(provenance.ir === undefined ? [] : [`IR \`${provenance.ir}\``]),
    ...(provenance.source === undefined ? [] : [itemLabel(provenance.source)]),
  ];
  if (sources.length > 0) {
    lines.push("", sources.join(" · "));
  }
  return lines.join("\n");
}

const hoverProvider: languages.HoverProvider = {
  provideHover: (model, position) => {
    const trace = traceOf(model);
    const provenance = trace === null ? null : provenanceAt(trace, position.lineNumber);
    if (provenance === null) {
      return null;
    }
    return {
      range: {
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: model.getLineMaxColumn(position.lineNumber),
      },
      contents: [{ value: provenanceMarkdown(provenance) }],
    };
  },
};

/** Registers the hover provider for both grammars; the disposables take it back. */
export function registerProvenanceHover(monaco: Monaco): IDisposable[] {
  return [PETRI_NET_IR_LANGUAGE, PYTHON_LANGUAGE].map((language) =>
    monaco.languages.registerHoverProvider(language, hoverProvider),
  );
}
