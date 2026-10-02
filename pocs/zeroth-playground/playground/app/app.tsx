import { Activity, useState } from "react";

import { compile } from "../../compiler";
import { FIRST_EXAMPLE, exampleById } from "../../examples/catalog";
import { CompilerView } from "../compiler-view/compiler-view";
import { PlaygroundView } from "../playground-view/playground-view";
import { useDwell } from "../pointer/use-dwell";
import { SemanticsView } from "../semantics-view/semantics-view";
import { type Document, documentOf, isChanged } from "./document";
import { Header } from "./header";
import { type Navigation, NavigationContext } from "./navigation";
import { type View, routeOf } from "./route";

import type { CompilerOptions } from "../../compiler";
import type { Hover } from "../playground-view/hover";

import "./app.css";

/**
 * The playground: the header over the three views. It holds the open document
 * and compiles it once per render for the two views that read it; each view
 * is hidden, not unmounted, while another shows, so folds, sizes and pins
 * survive the round trip. It also holds the selected question, so a page's
 * reference can open it in the Semantics view.
 */
export const App: React.FC = () => {
  const [route] = useState(() => routeOf(window.location.hash));
  const [view, setView] = useState<View>(route.view);
  const [document, setDocument] = useState<Document>(() => documentOf(route.example));
  const [selectedQuestion, setSelectedQuestion] = useState<string | null>(route.question?.id ?? null);
  // What the pointer has settled on: only a dwell lights anything.
  const [hover, pointAt] = useDwell<Hover | null>(null);
  const compilation = compile(document.irText, { options: document.options });
  const example = exampleById(document.exampleId) ?? FIRST_EXAMPLE;

  /** Opens the example, under the options given in place of the ones it opens with. */
  function selectExample(id: string, options?: CompilerOptions) {
    const example = exampleById(id);
    if (example !== undefined) {
      const opened = documentOf(example);
      setDocument(options === undefined ? opened : { ...opened, options });
      pointAt(null);
    }
  }

  const navigation: Navigation = {
    openQuestion: (id) => {
      setSelectedQuestion(id);
      setView("semantics");
    },
    openExample: (id, options) => {
      selectExample(id, options);
      setView("playground");
    },
  };

  return (
    <NavigationContext value={navigation}>
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
        <Activity mode={view === "playground" ? "visible" : "hidden"}>
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
        <Activity mode={view === "semantics" ? "visible" : "hidden"}>
          <main className="workspace">
            <SemanticsView selected={selectedQuestion} onSelect={setSelectedQuestion} />
          </main>
        </Activity>
      </div>
    </NavigationContext>
  );
};
