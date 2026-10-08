import { useState } from "react";

import { parseConstraintDocument, printMath } from "../../constraints";
import { MonacoEditor } from "../editor/monaco-editor";
import { conditionRanges } from "./condition-links";
import { metricDefinitions, withMathFormula } from "./constraint-text";

import type { Constraint } from "../../constraints/ast";
import type { AtomExpr } from "../../constraints/walk";
import type { Diagnostic } from "../../constraints";
import type { EditorMarker } from "../editor/monaco-editor";
import type { Analysis } from "./analysis";

import "./code-panel.css";

type CodePanelProps = {
  exampleId: string;
  constraintText: string;
  analysis: Analysis;
  /** What the builder shows: the constraint of the last text that parsed. */
  builder: { constraint: Constraint; metrics: string[] } | null;
  mtl: boolean;
  nested: boolean;
  onConstraintText: (text: string) => void;
  /** The conditions a hover has lit; where the file and the formula write them is marked. */
  linkedAtoms?: readonly AtomExpr[];
  /** Called with the height the panel's content needs, each time it changes. */
  onFit?: (height: number) => void;
};

const NO_ATOMS: readonly AtomExpr[] = [];

/** The formula as the user typed it, kept while the file it was written into is still the file shown. */
type MathDraft = { formula: string; forText: string; diagnostics: Diagnostic[] };

/** One line of the editor (`lineHeight` in `monaco-editor.tsx`) and the pads of the file editor. */
const LINE_PX = 18;
const FILE_PAD_PX = 16;
/** The most lines each editor shows before it scrolls. */
const FILE_LINES_MAX = 14;
const FORMULA_LINES_MAX = 6;
const DEFINITION_LINES_MAX = 8;
/** The pads of the formula and of the metric lines, which meet with no gap between them. */
const FORMULA_PAD = { top: 4, bottom: 0 };
const FORMULA_ALONE_PAD = { top: 4, bottom: 10 };
const DEFINITIONS_PAD = { top: 0, bottom: 10 };

/** The editors' content heights, `null` until an editor reports its own. */
type Heights = { file: number | null; formula: number | null; definitions: number | null };

/** An editor's height: its content, up to `lines` lines and their pads. */
function heightOf(content: number | null, lines: number, pads: number): number {
  return Math.min(content ?? LINE_PX + pads, lines * LINE_PX + pads);
}

function markersOf(diagnostics: Diagnostic[], lineOf: (diagnostic: Diagnostic) => number): EditorMarker[] {
  return diagnostics.map((diagnostic) => ({
    line: lineOf(diagnostic),
    message: diagnostic.message,
    severity: diagnostic.severity,
  }));
}

/**
 * The Code panel's body: the constraint.yaml, and under it the same
 * constraint in math notation. Both read colours by one set of roles. The
 * formula is editable: while it parses it replaces the file's `constraint:`
 * line, so the builder, the code and the math stay one constraint. The
 * metric lines follow the file and are read-only.
 */
export const CodePanel: React.FC<CodePanelProps> = ({
  exampleId,
  constraintText,
  analysis,
  builder,
  mtl,
  nested,
  onConstraintText,
  linkedAtoms = NO_ATOMS,
  onFit,
}) => {
  const [draft, setDraft] = useState<MathDraft | null>(null);
  const [heights, setHeights] = useState<Heights>({ file: null, formula: null, definitions: null });
  // A draft belongs to the file it was written into; a change from the builder or the code retires it.
  const live = draft !== null && draft.forText === constraintText ? draft : null;
  const formula = live?.formula ?? (builder === null ? "" : printMath(builder.constraint));
  const metrics = parseConstraintDocument(constraintText, { mtl, nested }).doc?.metrics ?? [];
  const hasDefinitions = metrics.length > 0;
  const linkedInFile = linkedAtoms.flatMap((atom) => conditionRanges(constraintText, atom));
  const linkedInFormula = linkedAtoms.flatMap((atom) => conditionRanges(formula, atom));
  const formulaPad = hasDefinitions ? FORMULA_PAD : FORMULA_ALONE_PAD;

  function editFormula(next: string) {
    const result = withMathFormula(constraintText, next, { mtl, nested });
    setDraft({ formula: next, forText: result.text, diagnostics: result.diagnostics });
    if (result.parses && result.text !== constraintText) {
      onConstraintText(result.text);
    }
  }

  // The observer reports the content's own height, which the pane's size does not change.
  const observe = (content: HTMLDivElement | null) => {
    if (content === null || onFit === undefined) {
      return;
    }
    const observer = new ResizeObserver(() => onFit(content.offsetHeight));
    observer.observe(content);
    return () => observer.disconnect();
  };

  return (
    <div className="code-scroll">
      <div className="code-stack" ref={observe}>
        <section className="code-section code-section--code" aria-label="constraint.yaml">
          <p className="code-section__head">
            <span className="caps code-section__file">constraint.yaml</span>
            <span className="code-section__hint">editable</span>
          </p>
          <div
            className="code-section__editor"
            style={{ height: heightOf(heights.file, FILE_LINES_MAX, FILE_PAD_PX) }}
          >
            <MonacoEditor
              path={`${exampleId}/constraint.yaml`}
              language="constraint-yaml"
              value={constraintText}
              onChange={onConstraintText}
              linkedRanges={linkedInFile}
              onContentHeight={(file) => setHeights((was) => ({ ...was, file }))}
              markers={markersOf(analysis.constraintDiagnostics, (diagnostic) => diagnostic.line ?? 1)}
            />
          </div>
        </section>
        <section className="code-section code-section--math" aria-label="Math">
          <p className="code-section__head">
            <span className="caps">Math</span>
            <span className="code-section__hint">edit the formula; metric lines are read-only</span>
          </p>
          <div
            className="code-section__editor"
            style={{ height: heightOf(heights.formula, FORMULA_LINES_MAX, formulaPad.top + formulaPad.bottom) }}
          >
            <MonacoEditor
              path={`${exampleId}/constraint.math`}
              language="constraint-math"
              plain
              padding={formulaPad}
              value={formula}
              onChange={editFormula}
              linkedRanges={linkedInFormula}
              onContentHeight={(formulaHeight) => setHeights((was) => ({ ...was, formula: formulaHeight }))}
              markers={markersOf(live?.diagnostics ?? [], () => 1)}
            />
          </div>
          {hasDefinitions ? (
            <div
              className="code-section__editor"
              style={{
                height: heightOf(
                  heights.definitions,
                  DEFINITION_LINES_MAX,
                  DEFINITIONS_PAD.top + DEFINITIONS_PAD.bottom,
                ),
              }}
            >
              <MonacoEditor
                path={`${exampleId}/metrics.math`}
                language="constraint-math"
                plain
                padding={DEFINITIONS_PAD}
                readOnly
                value={metricDefinitions(metrics)}
                onContentHeight={(definitions) => setHeights((was) => ({ ...was, definitions }))}
              />
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
};
