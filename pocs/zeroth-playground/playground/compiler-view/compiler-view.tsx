import "./compiler-view.css";

import { useId, useState } from "react";
import { Group, Panel as ResizablePanel, Separator, usePanelRef } from "react-resizable-panels";

import { useDwell } from "../pointer/use-dwell";
import { Panel } from "../ui/panel";
import { RESIZE_TARGET } from "../ui/resize-target";
import { useFolds } from "../ui/use-folds";
import CompilerGuide from "./compiler-guide.mdx";
import { focusHandoff } from "./focus-handoff";
import { PipelineGraph } from "./pipeline-graph";
import { StageCard } from "./stage-card";
import { StageFocusContext } from "./stage-focus";
import { StageOverview } from "./stage-overview";
import { stageSamples } from "./stage-sample";

import type { StageFocus } from "./stage-focus";
import type { SampleInput } from "./stage-sample";
import type { StageId } from "./stages";

/** The one panel of the view that folds. */
const FOLDS = ["guide"] as const;

/**
 * How the compiler works: the guide on the left, and on the right the graph
 * of every stage over the card of the focused one, read off the example in
 * the editor. A hover focuses a stage once the pointer settles on it, as in
 * the examples view; a keyboard focus focuses it at once, and a click pins
 * it. The card follows the hovered stage, else the keyboard's, else the
 * pinned one, else lists them all. Every stage's sample is read once per render,
 * off the example: its title, its IR text, its options and what it compiles to.
 */
export const CompilerView: React.FC<SampleInput> = (input) => {
  const [hovered, pointAt] = useDwell<StageId | null>(null);
  const [keyboard, setKeyboard] = useState<StageId | null>(null);
  const [pinned, setPinned] = useState<StageId | null>(null);
  const guideRef = usePanelRef();
  const folds = useFolds(FOLDS, () => guideRef.current);
  const handoff = focusHandoff(useId());
  const focused = hovered ?? keyboard ?? pinned;
  const samples = stageSamples(input);
  const card = samples.find(({ stage }) => stage.id === focused);
  const focus: StageFocus = {
    focused,
    pinned,
    hover: pointAt,
    focusKeyboard: setKeyboard,
    togglePin: (stage) => setPinned(pinned === stage ? null : stage),
  };

  return (
    <StageFocusContext value={focus}>
      <Group
        orientation="horizontal"
        className={folds.easing ? "stack stack--easing" : "stack"}
        resizeTargetMinimumSize={RESIZE_TARGET}
        onLayoutChange={folds.sync}
      >
        <ResizablePanel
          id="guide"
          panelRef={guideRef}
          collapsible
          collapsedSize="2rem"
          minSize="18%"
          defaultSize="30%"
        >
          <Panel title="Compiler guide" fold={folds.foldOf("guide", "start")}>
            <article className="docs compiler-guide">
              <CompilerGuide />
            </article>
          </Panel>
        </ResizablePanel>
        <Separator className="gridline gridline--column" />
        <ResizablePanel id="pipeline-and-stage" minSize="40%">
          <Group orientation="vertical" className="stack" resizeTargetMinimumSize={RESIZE_TARGET}>
            <ResizablePanel id="pipeline" minSize="38%" defaultSize="46%">
              <Panel title="Pipeline">
                <PipelineGraph samples={samples} />
              </Panel>
            </ResizablePanel>
            <Separator className="gridline gridline--row" />
            <ResizablePanel id="stage" minSize="20%">
              <Panel title="Stage">
                {card === undefined ? (
                  <StageOverview exampleTitle={input.exampleTitle} samples={samples} handoff={handoff} />
                ) : (
                  <StageCard
                    stage={card.stage}
                    sample={card.sample}
                    exampleTitle={input.exampleTitle}
                    handoff={handoff}
                  />
                )}
              </Panel>
            </ResizablePanel>
          </Group>
        </ResizablePanel>
      </Group>
    </StageFocusContext>
  );
};
