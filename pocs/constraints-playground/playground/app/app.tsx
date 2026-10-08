import { useState } from "react";

import { parseConstraintDocument, printConstraint } from "../../constraints";
import { DEFAULT_EXAMPLE, exampleById } from "../../examples/catalog";
import { analyse } from "../constraint-panel/analysis";
import { withConstraintLine } from "../constraint-panel/constraint-text";
import { PlaygroundView } from "../playground-view/playground-view";
import { type Document, documentOf, isChanged, withBlankRule, withConstraintText } from "./document";
import { Header } from "./header";
import { navigate, useRoute } from "./router";

import type { Constraint, ConstraintDocument } from "../../constraints/ast";
import type { ConstraintFlags } from "../../constraints";
import type { Example } from "../../examples/catalog";

import "./app.css";

/** The constraint file as it parses, or `null` while it does not. */
function validDocOf(text: string, flags: ConstraintFlags): ConstraintDocument | null {
  const parsed = parseConstraintDocument(text, flags);
  return parsed.doc ?? null;
}

/** A seed replacing the example's own, for the example it was set on. */
type SeedOverride = { exampleId: string; seed: number };

/** A fresh seed for Re-run. */
function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

/**
 * The playground: the header over the one view. The URL hash says which
 * example is open, through `useRoute`; the app keeps that example's document
 * and parses and runs it during render. The builder shows the constraint of
 * the last text that parsed, so it holds steady while the text is mid-edit.
 */
export const App: React.FC = () => {
  const route = useRoute();
  const { mtl, nested } = route;
  const flags: ConstraintFlags = { mtl, nested };
  const [example, setExample] = useState<Example>(() => route.example ?? DEFAULT_EXAMPLE);
  const [document, setDocument] = useState<Document>(() => documentOf(example));
  const [lastValid, setLastValid] = useState<ConstraintDocument | null>(() => validDocOf(example.constraint, flags));
  const [flagsSeen, setFlagsSeen] = useState(flags);
  const [seedOverride, setSeedOverride] = useState<SeedOverride | null>(null);

  /** Opens the example's own texts, dropping every edit and the seed. */
  function open(next: Example) {
    setExample(next);
    setDocument(documentOf(next));
    setLastValid(validDocOf(next.constraint, flags));
    setSeedOverride(null);
  }

  // Flipping a flag reads the text again: a window or a nested operator parses or stops parsing, and the builder follows what parses.
  if (mtl !== flagsSeen.mtl || nested !== flagsSeen.nested) {
    setFlagsSeen(flags);
    const valid = validDocOf(document.constraintText, flags);
    if (valid !== null) {
      setLastValid(valid);
    }
  }

  // A hash naming another example rebuilds the document from the catalog.
  if (route.example !== undefined && route.example.id !== example.id) {
    setExample(route.example);
    setDocument(documentOf(route.example));
    setLastValid(validDocOf(route.example.constraint, flags));
    setSeedOverride(null);
  }

  const opening = documentOf(example);
  const seed = seedOverride?.exampleId === example.id ? seedOverride.seed : null;
  const analysis = analyse(document.irText, document.constraintText, seed, mtl, nested);
  const shownSeed = seed ?? analysis.doc?.run.seed ?? lastValid?.run.seed ?? 0;

  /** Takes a new constraint text from either side, and keeps the builder's last valid parse. */
  function commitConstraintText(text: string) {
    setDocument(withConstraintText(document, text));
    const valid = validDocOf(text, flags);
    if (valid !== null) {
      setLastValid(valid);
    }
  }

  /** Replaces the constraint with a hole; the net, the metrics and the seed stay. */
  function blankRule() {
    commitConstraintText(withBlankRule(document).constraintText);
  }

  function selectExample(id: string) {
    const next = exampleById(id);
    if (next !== undefined) {
      navigate({ example: next, mtl: mtl || next.mtl === true, nested: nested || next.nested === true });
    }
  }

  /** Turning MTL off while an MTL example is open leaves it for the sandbox. */
  function toggleMtl(next: boolean) {
    navigate(next || !example.mtl ? { example, mtl: next, nested } : { example: DEFAULT_EXAMPLE, mtl: false, nested });
  }

  /** Turning Nested operators off while an example that nests is open leaves it for the sandbox. */
  function toggleNested(next: boolean) {
    navigate(next || !example.nested ? { example, mtl, nested: next } : { example: DEFAULT_EXAMPLE, mtl, nested: false });
  }

  return (
    <div className="app">
      <Header
        exampleId={example.id}
        changed={isChanged(document, opening)}
        mtl={mtl}
        nested={nested}
        onSelectExample={selectExample}
        onReset={() => open(example)}
        onToggleMtl={toggleMtl}
        onToggleNested={toggleNested}
      />
      <main className="workspace">
        <PlaygroundView
          document={document}
          analysis={analysis}
          onChange={setDocument}
          builder={
            lastValid === null
              ? null
              : { constraint: lastValid.constraint, metrics: lastValid.metrics.map((metric) => metric.name) }
          }
          seed={shownSeed}
          mtl={mtl}
          nested={nested}
          onConstraintText={commitConstraintText}
          onBuilderChange={(constraint: Constraint) =>
            commitConstraintText(withConstraintLine(document.constraintText, printConstraint(constraint)))
          }
          onBlankRule={blankRule}
          onSeed={(next) => setSeedOverride({ exampleId: example.id, seed: next })}
          onRerun={() => setSeedOverride({ exampleId: example.id, seed: randomSeed() })}
        />
      </main>
    </div>
  );
};
