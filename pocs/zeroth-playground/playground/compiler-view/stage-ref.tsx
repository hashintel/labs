import { stageById } from "./stages";
import { useStageTarget } from "./stage-focus";

import type { StageId } from "./stages";

import "./stage-ref.css";

type StageRefProps = {
  stage: StageId;
  children: React.ReactNode;
};

/**
 * A stage named in the guide's prose: hovering or focusing it focuses the
 * stage in the graph and opens its card, a click pins it there.
 */
export const StageRef: React.FC<StageRefProps> = ({ stage, children }) => {
  const { focused, pinned, handlers } = useStageTarget(stage);
  return (
    <button
      type="button"
      className="stage-ref"
      data-stage={stage}
      data-focused={focused === stage}
      aria-pressed={pinned === stage}
      title={`${stageById(stage).title}: ${pinned === stage ? "click to unpin" : "click to pin"}`}
      {...handlers}
    >
      {children}
    </button>
  );
};
