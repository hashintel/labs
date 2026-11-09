import { useRef } from "react";
import { Cell, Grid, Gridline, useGridRef } from "react-resizable-panels";

import { optionStates } from "../../compiler";
import { withIrText, withOptionText } from "../app/document";
import { Documentation } from "../docs/documentation";
import { type CodeEditor, MonacoEditor } from "../editor/monaco-editor";
import { OPTION_LABELS } from "../options/option-labels";
import { NetPreview } from "../preview/net-preview";
import { Panel } from "../ui/panel";
import { RESIZE_TARGET } from "../ui/resize-target";
import { type Foldable, useFolds } from "../ui/use-folds";
import { CompilerOptionsPanel } from "./compiler-options-panel";
import { type Hover, hoverAtLine, hoverAtSource, litLines } from "./hover";
import { ModuleView } from "./module-view";

import type { Compilation, Diagnostic } from "../../compiler";
import type { Document } from "../app/document";
import type { LineDecoration } from "../editor/line-decorations";

import "../ui/resizable.css";
import "./playground-view.css";

type PlaygroundViewProps = {
  document: Document;
  /** The document compiled, once per render, by the app. */
  compilation: Compilation;
  onChange: (document: Document) => void;
  /** What the pointer has settled on in the IR, the module or the preview. */
  hover: Hover | null;
  onHover: (hover: Hover | null) => void;
};

const GRID_FOLDS = ["documentation", "preview"] as const;

/** The IR lines the diagnostics point at. */
function diagnosticLines(
  diagnostics: readonly Diagnostic[],
  kind: "error" | "warning",
): LineDecoration[] {
  return diagnostics.flatMap((diagnostic) =>
    diagnostic.line === undefined
      ? []
      : [{ startLine: diagnostic.line, endLine: diagnostic.line, kind }],
  );
}

export const PlaygroundView: React.FC<PlaygroundViewProps> = ({ document, compilation, onChange, hover, onHover }) => {
  const irEditorRef = useRef<CodeEditor | null>(null);
  const gridRef = useGridRef();

  function trackHandle(key: (typeof GRID_FOLDS)[number]): Foldable | undefined {
    return gridRef.current?.getTrackById(key === "documentation" ? "column" : "row", key);
  }

  const gridFolds = useFolds(GRID_FOLDS, trackHandle);
  const { ir } = compilation;
  const optionRows = ir === null ? [] : optionStates(ir, document.options).filter(
    (state) => state.notApplicable === undefined && OPTION_LABELS.some((labels) => labels.name === state.name),
  );
  const irDecorations = [
    ...litLines("ir", compilation.irTrace, hover),
    ...diagnosticLines(compilation.errors, "error"),
    ...diagnosticLines(compilation.warnings, "warning"),
  ];

  function revealIrLine(line: number) {
    const instance = irEditorRef.current;
    instance?.revealLineInCenter(line);
    instance?.setPosition({ lineNumber: line, column: 1 });
    instance?.focus();
  }

  return (
    <Grid
      className={gridFolds.easing ? "workspace__grid workspace__grid--easing" : "workspace__grid"}
      gridRef={gridRef}
      columns={[
        { id: "documentation", minSize: "14%", collapsible: true, collapsedSize: "2rem" },
        { id: "ir", minSize: "18%" },
        { id: "module", minSize: "18%" },
      ]}
      rows={[
        { id: "editors", minSize: "18%" },
        { id: "preview", minSize: "18%", collapsible: true, collapsedSize: "2rem" },
      ]}
      defaultLayout={{
        columns: { documentation: 26, ir: 34, module: 40 },
        rows: { editors: 72, preview: 28 },
      }}
      resizeTargetMinimumSize={RESIZE_TARGET}
      onLayoutChange={gridFolds.sync}
    >
      <Cell column={0} row={0} rowSpan={2}>
        <Panel title="Example" fold={gridFolds.foldOf("documentation", "start")}>
          <Documentation exampleId={document.exampleId} />
        </Panel>
      </Cell>
      <Cell column={1} row={0}>
        <div className="input-stack">
          <Panel title="Petri net · YAML">
            <MonacoEditor
              path={`${document.exampleId}/net.pn.yaml`}
              language="petri-net-ir"
              stickyScroll
              value={document.irText}
              onChange={(irText) => onChange(withIrText(document, irText))}
              trace={compilation.irTrace}
              decorations={irDecorations}
              onHoverLine={(line) => onHover(hoverAtLine("ir", compilation.irTrace, line))}
              editorRef={irEditorRef}
            />
          </Panel>
          {optionRows.length > 0 ? (
            <details className="input-options">
              <summary>Options</summary>
              <CompilerOptionsPanel
                states={optionRows}
                onChange={(name, value) => {
                  if (ir !== null) {
                    onChange(withOptionText(document, ir, name, value));
                  }
                }}
              />
            </details>
          ) : null}
        </div>
      </Cell>
      <Cell column={2} row={0}>
        <Panel title="Zeroth · Python">
          <ModuleView
            exampleId={document.exampleId}
            compilation={compilation}
            hover={hover}
            onHover={onHover}
            onRevealIrLine={revealIrLine}
          />
        </Panel>
      </Cell>
      <Cell column={1} row={1} columnSpan={2}>
        <Panel title="Net" fold={gridFolds.foldOf("preview", "bottom")}>
          {ir === null ? (
            <p className="note">Enter a valid Petri net to see the diagram.</p>
          ) : (
            <NetPreview
              ir={ir}
              lit={hover?.provenance.source ?? null}
              onHover={(source) => onHover(hoverAtSource(source))}
            />
          )}
        </Panel>
      </Cell>
      {/* The documentation column's line spans both rows; the other two cross under the editors. */}
      <Gridline type="column" column={1} className="gridline gridline--column" />
      <Gridline type="column" column={2} row={0} rowSpan={1} className="gridline gridline--column" />
      <Gridline type="row" row={1} column={1} columnSpan={2} className="gridline gridline--row" />
    </Grid>
  );
};
