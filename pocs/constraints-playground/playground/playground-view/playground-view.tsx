import { useState } from "react";
import { Cell, Grid, Gridline, useGridRef } from "react-resizable-panels";

import { parseConstraintDocument } from "../../constraints";
import { NO_LINK, resolveLink } from "../constraint-panel/condition-links";

import { withIrText } from "../app/document";
import { ConstraintPanel } from "../constraint-panel/constraint-panel";
import { Documentation } from "../docs/documentation";
import { MonacoEditor } from "../editor/monaco-editor";
import { NetPreview } from "../preview/net-preview";
import { Panel } from "../ui/panel";
import { RESIZE_TARGET } from "../ui/resize-target";
import { type Foldable, useFolds } from "../ui/use-folds";

import type { Document } from "../app/document";
import type { NetItem } from "../../compiler";
import type { Analysis } from "../constraint-panel/analysis";
import type { ConstraintPanelProps } from "../constraint-panel/constraint-panel";
import type { EditorMarker } from "../editor/monaco-editor";

import "../ui/resizable.css";
import "./playground-view.css";

type PlaygroundViewProps = Pick<
  ConstraintPanelProps,
  "builder" | "seed" | "mtl" | "nested" | "onConstraintText" | "onBuilderChange" | "onBlankRule" | "onSeed" | "onRerun"
> & {
  document: Document;
  analysis: Analysis;
  onChange: (document: Document) => void;
};

/** The panels that fold, by the grid track that owns them. */
const GRID_FOLDS = ["documentation", "preview"] as const;

/** The net's diagnostics as markers on its text. */
function irMarkers(analysis: Analysis): EditorMarker[] {
  return analysis.irDiagnostics.map((diagnostic) => ({
    line: diagnostic.line ?? 1,
    message: diagnostic.message,
    severity: "error",
  }));
}

/**
 * The Playground view: the example's page down the left; the net IR editor
 * over the net preview in the middle; the Constraint panel down the right.
 */
export const PlaygroundView: React.FC<PlaygroundViewProps> = ({
  document,
  analysis,
  onChange,
  builder,
  seed,
  mtl,
  nested,
  onConstraintText,
  onBuilderChange,
  onBlankRule,
  onSeed,
  onRerun,
}) => {
  const gridRef = useGridRef();

  function trackHandle(key: (typeof GRID_FOLDS)[number]): Foldable | undefined {
    return gridRef.current?.getTrackById(key === "documentation" ? "column" : "row", key);
  }

  const gridFolds = useFolds(GRID_FOLDS, trackHandle);
  const { ir } = analysis;
  // One hover, shared by the builder, both editors, the net and the Run chart: the conditions under the pointer, by canonical text.
  const [hovered, setHovered] = useState<string[] | null>(null);
  const linked =
    hovered === null || builder === null
      ? NO_LINK
      : resolveLink(
          builder.constraint,
          hovered,
          parseConstraintDocument(document.constraintText, { mtl, nested }).doc?.metrics ?? [],
        );
  const linkedItems: NetItem[] = [
    ...linked.places.map((name) => ({ kind: "place" as const, name })),
    ...linked.transitions.map((name) => ({ kind: "transition" as const, name })),
  ];

  return (
    <Grid
      className={gridFolds.easing ? "workspace__grid workspace__grid--easing" : "workspace__grid"}
      gridRef={gridRef}
      columns={[
        { id: "documentation", minSize: "14%", collapsible: true, collapsedSize: "2rem" },
        { id: "net", minSize: "18%" },
        { id: "constraint", minSize: "22%" },
      ]}
      rows={[
        { id: "ir", minSize: "18%" },
        { id: "preview", minSize: "18%", collapsible: true, collapsedSize: "2rem" },
      ]}
      defaultLayout={{
        columns: { documentation: 24, net: 34, constraint: 42 },
        rows: { ir: 55, preview: 45 },
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
        <Panel title="Petri net IR">
          <MonacoEditor
            path={`${document.exampleId}/net.pn.yaml`}
            language="petri-net-ir"
            stickyScroll
            value={document.irText}
            onChange={(irText) => onChange(withIrText(document, irText))}
            markers={irMarkers(analysis)}
          />
        </Panel>
      </Cell>
      <Cell column={1} row={1}>
        <Panel title="Net preview" fold={gridFolds.foldOf("preview", "bottom")}>
          {ir === null ? (
            <p className="note">The net draws once the text parses as an IR.</p>
          ) : (
            <NetPreview ir={ir} lit={null} onHover={() => {}} linked={linkedItems} />
          )}
        </Panel>
      </Cell>
      <Cell column={2} row={0} rowSpan={2}>
        <ConstraintPanel
          exampleId={document.exampleId}
          constraintText={document.constraintText}
          analysis={analysis}
          builder={builder}
          seed={seed}
          mtl={mtl}
          nested={nested}
          onConstraintText={onConstraintText}
          onBuilderChange={onBuilderChange}
          onBlankRule={onBlankRule}
          onSeed={onSeed}
          onRerun={onRerun}
          linked={linked}
          onLink={setHovered}
        />
      </Cell>
      <Gridline type="column" column={1} className="gridline gridline--column" />
      <Gridline type="column" column={2} className="gridline gridline--column" />
      <Gridline type="row" row={1} column={1} columnSpan={1} className="gridline gridline--row" />
    </Grid>
  );
};
