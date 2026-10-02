import { useRef } from "react";
import {
  Cell,
  Grid,
  Gridline,
  Group,
  Panel as ResizablePanel,
  Separator,
  useGridRef,
  usePanelRef,
} from "react-resizable-panels";

import { optionStates } from "../../compiler";
import { withIrText, withOptionText } from "../app/document";
import { Documentation } from "../docs/documentation";
import { type CodeEditor, MonacoEditor } from "../editor/monaco-editor";
import { NetPreview } from "../preview/net-preview";
import { Panel } from "../ui/panel";
import { RESIZE_TARGET } from "../ui/resize-target";
import { Switch } from "../ui/switch";
import { type Foldable, useFolds } from "../ui/use-folds";
import { CompilerOptionsPanel } from "./compiler-options-panel";
import { type Hover, hoverAtLine, hoverAtSource, litLines } from "./hover";
import { toggleEditing } from "./module-edits";
import { ModuleView } from "./module-view";

import type { Compilation, Diagnostic } from "../../compiler";
import type { Document } from "../app/document";
import type { LineDecoration } from "../editor/line-decorations";

import "../ui/resizable.css";
import "./examples-view.css";

type ExamplesViewProps = {
  document: Document;
  /** The document compiled, once per render, by the app. */
  compilation: Compilation;
  onChange: (document: Document) => void;
  /** What the pointer has settled on in the IR, the module or the preview. */
  hover: Hover | null;
  onHover: (hover: Hover | null) => void;
};

/**
 * The panels that fold, by the container that owns them. Each container's
 * layout callback reads only its own handles: the grid's tracks are not
 * there while Activity has the grid unmounted, and a nested group may report
 * its layout before the grid around it has mounted again.
 */
const GRID_FOLDS = ["documentation", "preview"] as const;
const STACK_FOLDS = ["options"] as const;

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

/**
 * The Examples view: the example's page down the left; the IR editor over
 * the compiler options, and the emitted module beside them; the net preview
 * under both. A hover in the IR, the module or the preview lights what
 * belongs with it in the other two.
 */
export const ExamplesView: React.FC<ExamplesViewProps> = ({ document, compilation, onChange, hover, onHover }) => {
  const irEditorRef = useRef<CodeEditor | null>(null);
  const gridRef = useGridRef();
  const optionsRef = usePanelRef();

  function trackHandle(key: (typeof GRID_FOLDS)[number]): Foldable | undefined {
    return gridRef.current?.getTrackById(key === "documentation" ? "column" : "row", key);
  }

  const gridFolds = useFolds(GRID_FOLDS, trackHandle);
  const stackFolds = useFolds(STACK_FOLDS, () => optionsRef.current);
  const { ir } = compilation;
  const optionRows = ir === null ? [] : optionStates(ir, document.options);
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
        columns: { documentation: 24, ir: 38, module: 38 },
        rows: { editors: 62, preview: 38 },
      }}
      resizeTargetMinimumSize={RESIZE_TARGET}
      onLayoutChange={gridFolds.sync}
    >
      <Cell column={0} row={0} rowSpan={2}>
        <Panel title="Documentation" fold={gridFolds.foldOf("documentation", "start")}>
          <Documentation exampleId={document.exampleId} />
        </Panel>
      </Cell>
      <Cell column={1} row={0}>
        <Group
          orientation="vertical"
          className={stackFolds.easing ? "stack stack--easing" : "stack"}
          resizeTargetMinimumSize={RESIZE_TARGET}
          onLayoutChange={stackFolds.sync}
        >
          <ResizablePanel id="ir" minSize="30%">
            <Panel title="Petri net IR">
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
          </ResizablePanel>
          <Separator className="gridline gridline--row" />
          <ResizablePanel
            id="options"
            panelRef={optionsRef}
            collapsible
            collapsedSize="2rem"
            minSize="6rem"
            maxSize="75%"
            defaultSize="50%"
          >
            <Panel title="Compiler options" fold={stackFolds.foldOf("options", "bottom")}>
              <CompilerOptionsPanel
                states={optionRows}
                onChange={(name, value) => {
                  if (ir !== null) {
                    onChange(withOptionText(document, ir, name, value));
                  }
                }}
              />
            </Panel>
          </ResizablePanel>
        </Group>
      </Cell>
      <Cell column={2} row={0}>
        <Panel
          title="Reactive module"
          actions={
            <Switch
              label="Edit"
              checked={document.module.editing}
              disabled={compilation.files.length === 0}
              title="Edit the emitted module by hand; a change to the IR or the options writes it again"
              onChange={() => onChange({ ...document, module: toggleEditing(document.module) })}
            />
          }
        >
          <ModuleView
            exampleId={document.exampleId}
            compilation={compilation}
            edits={document.module}
            onEdit={(module) => onChange({ ...document, module })}
            hover={hover}
            onHover={onHover}
            onRevealIrLine={revealIrLine}
          />
        </Panel>
      </Cell>
      <Cell column={1} row={1} columnSpan={2}>
        <Panel title="Net preview" fold={gridFolds.foldOf("preview", "bottom")}>
          {ir === null ? (
            <p className="note">The net draws once the text parses as an IR.</p>
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
