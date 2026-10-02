import { Activity, useState } from "react";

import { compile } from "../../compiler";
import { FIRST_EXAMPLE, exampleById } from "../../examples/catalog";
import { CompilerView } from "../compiler-view/compiler-view";
import { sameOptions } from "../options/option-edits";
import { PlaygroundView } from "../playground-view/playground-view";
import { useDwell } from "../pointer/use-dwell";
import { SemanticsView } from "../semantics-view/semantics-view";
import { type Document, documentOf, isChanged } from "./document";
import { Header } from "./header";
import { type Route, type View, hashOf } from "./route";
import { navigate, useRoute } from "./router";

import type { CompilerOptions } from "../../compiler";
import type { Example } from "../../examples/catalog";
import type { Question } from "../../semantics/register";
import type { Hover } from "../playground-view/hover";

import "./app.css";

/** The example the Playground and Compiler views work on, and the options it opened with. */
type Entry = { example: Example; options: CompilerOptions };

/** The entry a route names, or the current one when the route names no example. */
function entryOf(route: Route, current: Entry): Entry {
  if (route.view === "semantics" || route.example === undefined) {
    return current;
  }
  return { example: route.example, options: route.options ?? route.example.options };
}

function sameEntry(a: Entry, b: Entry): boolean {
  return a.example.id === b.example.id && sameOptions(a.options, b.options);
}

/** A view's hash on the entry, carrying the options only where they differ from the example's own. */
function targetOf(view: "playground" | "compiler", entry: Entry): string {
  const options = sameOptions(entry.options, entry.example.options) ? {} : { options: entry.options };
  return hashOf({ view, example: entry.example, ...options });
}

/**
 * The playground: the header over the three views. The URL hash says where
 * the app is, through `useRoute`; the app renders the view it names and keeps
 * the document of the example it names, compiled once per render for the two
 * views that read it. Each view is hidden, not unmounted, while another
 * shows, so folds, sizes and pins survive the round trip.
 */
export const App: React.FC = () => {
  const route = useRoute();
  const [entry, setEntry] = useState<Entry>(() =>
    entryOf(route, { example: FIRST_EXAMPLE, options: FIRST_EXAMPLE.options }),
  );
  const [document, setDocument] = useState<Document>(() => documentOf(entry.example, entry.options));
  // The question last selected, so the view switch returns to it.
  const [lastQuestion, setLastQuestion] = useState<Question | null>(
    route.view === "semantics" ? (route.question ?? null) : null,
  );
  // What the pointer has settled on: only a dwell lights anything.
  const [hover, pointAt] = useDwell<Hover | null>(null);

  // A hash naming another example, or other options, re-enters: the document is rebuilt from it.
  const next = entryOf(route, entry);
  if (!sameEntry(next, entry)) {
    setEntry(next);
    setDocument(documentOf(next.example, next.options));
  }
  if (route.view === "semantics" && (route.question?.id ?? null) !== (lastQuestion?.id ?? null)) {
    setLastQuestion(route.question ?? null);
  }

  const opening = documentOf(entry.example, entry.options);
  const compilation = compile(document.irText, { options: document.options });
  const targets: Record<View, string> = {
    playground: targetOf("playground", entry),
    compiler: targetOf("compiler", entry),
    semantics: hashOf({ view: "semantics", ...(lastQuestion === null ? {} : { question: lastQuestion }) }),
  };

  /** Opens an example in the view that shows examples, as it opens. */
  function selectExample(id: string) {
    const example = exampleById(id);
    if (example !== undefined) {
      pointAt(null);
      navigate({ view: route.view === "compiler" ? "compiler" : "playground", example });
    }
  }

  return (
    <div className="app">
      <Header
        view={route.view}
        targets={targets}
        exampleId={entry.example.id}
        changed={isChanged(document, opening)}
        onSelectExample={selectExample}
        onReset={() => setDocument(opening)}
      />
      <Activity mode={route.view === "compiler" ? "visible" : "hidden"}>
        <main className="workspace">
          <CompilerView
            exampleTitle={entry.example.title}
            irText={document.irText}
            options={document.options}
            compilation={compilation}
          />
        </main>
      </Activity>
      <Activity mode={route.view === "playground" ? "visible" : "hidden"}>
        <main className="workspace">
          <PlaygroundView
            document={document}
            compilation={compilation}
            onChange={setDocument}
            hover={hover}
            onHover={pointAt}
          />
        </main>
      </Activity>
      <Activity mode={route.view === "semantics" ? "visible" : "hidden"}>
        <main className="workspace">
          <SemanticsView question={lastQuestion ?? undefined} />
        </main>
      </Activity>
    </div>
  );
};
