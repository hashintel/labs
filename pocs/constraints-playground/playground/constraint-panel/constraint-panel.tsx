import { useRef } from "react";
import { Group, Panel as ResizablePanel, Separator, useGroupRef, usePanelRef } from "react-resizable-panels";

import { Panel } from "../ui/panel";
import { RESIZE_TARGET } from "../ui/resize-target";
import { BuilderSlot } from "./builder-slot";
import { CodePanel } from "./code-panel";
import { RunPanel } from "./run-panel";

import type { Constraint } from "../../constraints/ast";
import type { Analysis } from "./analysis";
import type { ResolvedLink } from "./condition-links";

export type ConstraintPanelProps = {
  exampleId: string;
  constraintText: string;
  analysis: Analysis;
  /** What the builder shows: the constraint of the last text that parsed. */
  builder: { constraint: Constraint; metrics: string[] } | null;
  seed: number;
  /** MTL is on: the builder offers windows. */
  mtl: boolean;
  /** Nested operators are on: the builder offers "+ Temporal operator". */
  nested: boolean;
  onConstraintText: (text: string) => void;
  onBuilderChange: (constraint: Constraint) => void;
  /** Replaces the constraint with an empty `always`, keeping the net and the metrics. */
  onBlankRule: () => void;
  onSeed: (seed: number) => void;
  onRerun: () => void;
  /** What a hover on a condition lights, in every view. */
  linked: ResolvedLink;
  /** A hover on a condition, in the builder or on the Run chart, reports its canonical text; leaving reports `null`. */
  onLink: (keys: string[] | null) => void;
};

/** The builder's head, which its pane holds besides the content: `--panel-head`, 2rem. */
const HEAD_PX = 32;

/** The most of the stack the builder takes; past it the builder scrolls. */
const BUILDER_MAX = 0.6;

/** What each pane's content needs, in pixels, besides the head; `0` until the content reports. */
type Needs = { builder: number; code: number; run: number };

/**
 * The Constraint panel: the no-code builder over the Code panel (the
 * constraint.yaml and the Math view), over the Run. The builder, the code and
 * the math are three views of one constraint: an edit in any of them reaches
 * the others through the constraint text.
 */
export const ConstraintPanel: React.FC<ConstraintPanelProps> = ({
  exampleId,
  constraintText,
  analysis,
  builder,
  seed,
  mtl,
  nested,
  onConstraintText,
  onBuilderChange,
  onBlankRule,
  onSeed,
  onRerun,
  linked,
  onLink,
}) => {
  const { ir } = analysis;
  const builderPanel = usePanelRef();
  const group = useGroupRef();

  const needs = useRef<Needs>({ builder: 0, code: 0, run: 0 });
  const stack = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);

  /**
   * Sizes each pane to its content and gives the Run the rest. No pane gives
   * way to a short viewport: when the panes need more than the column's
   * height, the group grows to what they need and the column scrolls as one.
   */
  function fit() {
    const handle = builderPanel.current;
    const layout = group.current;
    const total = stack.current?.offsetHeight ?? 0;
    if (handle === null || layout === null || total <= 0) {
      return;
    }
    const { builder, code, run } = needs.current;
    const builderPx = Math.min(builder + HEAD_PX, total * BUILDER_MAX);
    const runPx = run + HEAD_PX + 1;
    const codePx = code + HEAD_PX + 1;
    const height = Math.max(total, builderPx + codePx + runPx);
    if (inner.current !== null) {
      inner.current.style.height = `${height}px`;
    }
    const percent = (px: number) => (px / height) * 100;
    const target = {
      builder: percent(builderPx),
      constraint: percent(codePx),
      run: percent(height - builderPx - codePx),
    };
    const now = layout.getLayout();
    // Before the group has registered its panels the layout is empty and a set is lost; `onLayoutChange` retries.
    if (Object.keys(now).length === 0 || Object.entries(target).every(([id, size]) => Math.abs((now[id] ?? 0) - size) < 0.01)) {
      return;
    }
    layout.setLayout(target);
  }

  function need(pane: keyof Needs, height: number) {
    needs.current[pane] = height;
    fit();
  }

  // The stack's own size changes with the window; the panes follow it.
  const observeStack = (element: HTMLDivElement | null) => {
    stack.current = element;
    if (element === null) {
      return;
    }
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => {
      observer.disconnect();
      stack.current = null;
    };
  };

  return (
    <div className="constraint-stack" ref={observeStack}>
    <div className="constraint-stack__inner" ref={inner}>
    <Group groupRef={group} orientation="vertical" onLayoutChange={fit} className="stack" resizeTargetMinimumSize={RESIZE_TARGET}>
      <ResizablePanel id="builder" panelRef={builderPanel} minSize="5rem" defaultSize="38%">
        <Panel
          title="Constraint builder"
          actions={
            <button type="button" className="constraint-stack__action" onClick={onBlankRule}>
              Blank rule
            </button>
          }
        >
          <BuilderSlot
            value={builder?.constraint ?? null}
            metrics={builder?.metrics ?? []}
            places={ir === null ? [] : Object.keys(ir.places)}
            transitions={ir === null ? [] : Object.keys(ir.transitions)}
            mtl={mtl}
            nested={nested}
            textHasErrors={!analysis.textParses}
            onChange={onBuilderChange}
            linked={linked.keys}
            onLink={onLink}
            onFit={(height) => need("builder", height)}
          />
        </Panel>
      </ResizablePanel>
      <Separator className="gridline gridline--row" />
      <ResizablePanel id="constraint" minSize="5rem" defaultSize="32%">
        <Panel title="Code">
          <CodePanel
            exampleId={exampleId}
            constraintText={constraintText}
            analysis={analysis}
            builder={builder}
            mtl={mtl}
            nested={nested}
            onConstraintText={onConstraintText}
            linkedAtoms={linked.atoms}
            onFit={(height) => need("code", height)}
          />
        </Panel>
      </ResizablePanel>
      <Separator className="gridline gridline--row" />
      <ResizablePanel id="run" minSize="5rem" defaultSize="30%">
        <Panel title="Run">
          <RunPanel
            run={analysis.run}
            blocked={analysis.blocked}
            seed={seed}
            onSeed={onSeed}
            onRerun={onRerun}
            linked={linked.keys}
            onLink={onLink}
            onFit={(height) => need("run", height)}
          />
        </Panel>
      </ResizablePanel>
    </Group>
    </div>
    </div>
  );
};
