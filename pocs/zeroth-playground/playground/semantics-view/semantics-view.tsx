import { Group, Panel as ResizablePanel, Separator, usePanelRef } from "react-resizable-panels";

import { questionById } from "../../semantics/register";
import { Panel } from "../ui/panel";
import { RESIZE_TARGET } from "../ui/resize-target";
import { useFolds } from "../ui/use-folds";
import { QuestionCard } from "./question-card";
import { QuestionList } from "./question-list";
import { SemanticsIntro } from "./semantics-intro";

import "../ui/resizable.css";

/** The one panel of the view that folds. */
const FOLDS = ["questions"] as const;

type SemanticsViewProps = {
  /** The selected question's id; the app owns it, so a page can open a question here. */
  selected: string | null;
  onSelect: (id: string | null) => void;
};

/**
 * The questions on the semantics of the compilation: the list by topic on
 * the left, and on the right the selected question's card, or the intro and
 * the topics when none is selected. The view reads the register and the
 * catalog alone, never the document the Examples view has open.
 */
export const SemanticsView: React.FC<SemanticsViewProps> = ({ selected, onSelect }) => {
  const listRef = usePanelRef();
  const folds = useFolds(FOLDS, () => listRef.current);
  const question = selected === null ? undefined : questionById(selected);
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
          <QuestionList selected={selected} onSelect={onSelect} />
        </Panel>
      </ResizablePanel>
      <Separator className="gridline gridline--column" />
      <ResizablePanel id="question" minSize="40%">
        <Panel title="Question">
          {question === undefined ? (
            <SemanticsIntro />
          ) : (
            <QuestionCard question={question} onBack={() => onSelect(null)} />
          )}
        </Panel>
      </ResizablePanel>
    </Group>
  );
};
