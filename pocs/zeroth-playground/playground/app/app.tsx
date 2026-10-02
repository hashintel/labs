import { Activity, useState } from "react";

import { compile } from "../../compiler";
import { FIRST_EXAMPLE, exampleById } from "../../examples/catalog";
import { CompilerView } from "../compiler-view/compiler-view";
import { ExamplesView } from "../examples-view/examples-view";
import { useDwell } from "../pointer/use-dwell";
import { type Document, documentOf, isChanged } from "./document";
import { Header } from "./header";
import { type View, routeOf } from "./route";

import type { Hover } from "../examples-view/hover";

import "./app.css";

/**
 * The playground: the header over the two views. It holds the open document
 * and compiles it once per render for both views; each view is hidden, not
 * unmounted, while the other shows, so folds, sizes and pins survive the
 * round trip.
 */
export const App: React.FC = () => {
  const [route] = useState(() => routeOf(window.location.hash));
  const [view, setView] = useState<View>(route.view);
  const [document, setDocument] = useState<Document>(() => documentOf(route.example));
  // What the pointer has settled on: only a dwell lights anything.
  const [hover, pointAt] = useDwell<Hover | null>(null);
  const compilation = compile(document.irText, { options: document.options });
  const example = exampleById(document.exampleId) ?? FIRST_EXAMPLE;

  function selectExample(id: string) {
    const example = exampleById(id);
    if (example !== undefined) {
      setDocument(documentOf(example));
      pointAt(null);
    }
  }

  return (
    <div className="app">
      <Header
        view={view}
        onSelectView={setView}
        exampleId={document.exampleId}
        changed={isChanged(document, example)}
        onSelectExample={selectExample}
        onReset={() => selectExample(document.exampleId)}
      />
      <Activity mode={view === "compiler" ? "visible" : "hidden"}>
        <main className="workspace">
          <CompilerView
            exampleTitle={example.title}
            irText={document.irText}
            options={document.options}
            compilation={compilation}
          />
        </main>
      </Activity>
      <Activity mode={view === "examples" ? "visible" : "hidden"}>
        <main className="workspace">
          <ExamplesView
            document={document}
            compilation={compilation}
            onChange={setDocument}
            hover={hover}
            onHover={pointAt}
          />
        </main>
      </Activity>
    </div>
  );
};
