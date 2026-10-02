import { Group, Panel as ResizablePanel, Separator, usePanelRef } from "react-resizable-panels";

import { Panel } from "../ui/panel";
import { RESIZE_TARGET } from "../ui/resize-target";
import { useFolds } from "../ui/use-folds";
import { QuestionCard } from "./question-card";
import { QuestionList } from "./question-list";
import { SemanticsIntro } from "./semantics-intro";

import type { Question } from "../../semantics/register";

import "../ui/resizable.css";

/** The one panel of the view that folds. */
const FOLDS = ["questions"] as const;

type SemanticsViewProps = {
  /** The question the hash names, if any. */
  question?: Question;
};

/**
 * The questions on the semantics of the compilation: the list by topic on
 * the left, and on the right the selected question's card, or the intro and
 * the topics when none is selected. The view reads the register and the
 * catalog alone, never the document the Playground view has open.
 */
export const SemanticsView: React.FC<SemanticsViewProps> = ({ question }) => {
  const listRef = usePanelRef();
  const folds = useFolds(FOLDS, () => listRef.current);
  return (
    <Group
      orientation="horizontal"
      className={folds.easing ? "stack stack--easing" : "stack"}
      resizeTargetMinimumSize={RESIZE_TARGET}
      onLayoutChange={folds.sync}
    >
      <ResizablePanel
        id="questions"
        panelRef={listRef}
        collapsible
        collapsedSize="2rem"
        minSize="18%"
        defaultSize="32%"
      >
        <Panel title="Questions" fold={folds.foldOf("questions", "start")}>
          <QuestionList selected={question?.id ?? null} />
        </Panel>
      </ResizablePanel>
      <Separator className="gridline gridline--column" />
      <ResizablePanel id="question" minSize="40%">
        <Panel title="Question">
          {question === undefined ? (
            <SemanticsIntro />
          ) : (
            <QuestionCard question={question} />
          )}
        </Panel>
      </ResizablePanel>
    </Group>
  );
};
