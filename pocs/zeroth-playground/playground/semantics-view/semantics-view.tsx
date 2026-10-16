import { Group, Panel as ResizablePanel, Separator, usePanelRef } from "react-resizable-panels";

import { QUESTIONS } from "../../semantics/register";
import { Panel } from "../ui/panel";
import { RESIZE_TARGET } from "../ui/resize-target";
import { useFolds } from "../ui/use-folds";
import { QuestionCard } from "./question-card";
import { QuestionList } from "./question-list";

import type { Question } from "../../semantics/register";

import "../ui/resizable.css";

/** The one panel of the view that folds. */
const FOLDS = ["questions"] as const;

type SemanticsViewProps = {
  /** The question the hash names, if any. */
  question?: Question;
};

export const SemanticsView: React.FC<SemanticsViewProps> = ({ question }) => {
  const listRef = usePanelRef();
  const folds = useFolds(FOLDS, () => listRef.current);
  const selected = question ?? QUESTIONS[0];
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
        defaultSize="26%"
      >
        <Panel title="Questions" fold={folds.foldOf("questions", "start")}>
          <QuestionList selected={selected?.id ?? null} />
        </Panel>
      </ResizablePanel>
      <Separator className="gridline gridline--column" />
      <ResizablePanel id="question" minSize="40%">
        <Panel title="Question">
          {selected === undefined ? (
            <p className="note">No questions yet.</p>
          ) : (
            <QuestionCard question={selected} />
          )}
        </Panel>
      </ResizablePanel>
    </Group>
  );
};
