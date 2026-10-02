import { nodeFocus } from "../pipeline-layout";
import { useStageTarget } from "../stage-focus";
import { plainText } from "../rich-text";

import type { NodeBox } from "../pipeline-layout";
import type { SampleTone } from "../stage-sample";
import type { Stage } from "../stages";

type PipelineNodeProps = {
  stage: Stage;
  box: NodeBox;
  /** How the stage fared on the example: a refusing stage is marked, one not reached steps back. */
  tone: SampleTone;
};

/** Where the name and the note sit, from the centre: a document is taller. */
const TEXT_OFFSETS = { data: [-3.5, 12], step: [-2.5, 10.5], input: [-3, 11] } as const;

/**
 * One stage as a box: a document rounded on a grey ground, a step square
 * with its name in mono, a side input dashed. A corner notch marks what the
 * playground adds; a dot marks the pinned stage. A stage that refused the
 * example is drawn in red, one the example never reached steps back.
 * Focusable: Enter or Space pins, Escape unpins.
 */
export const PipelineNode: React.FC<PipelineNodeProps> = ({ stage, box, tone }) => {
  const { focused, pinned, togglePin, handlers } = useStageTarget(stage.id);
  const isPinned = pinned === stage.id;
  const left = box.x - box.width / 2;
  const top = box.y - box.height / 2;
  const [labelDy, noteDy] = TEXT_OFFSETS[stage.kind];
  return (
    <g
      className="pipeline__node"
      data-stage={stage.id}
      data-kind={stage.kind}
      data-owner={stage.owner}
      data-state={nodeFocus(stage.id, focused)}
      data-tone={tone}
      data-pinned={isPinned}
      tabIndex={0}
      role="button"
      aria-pressed={isPinned}
      aria-label={stage.title}
      {...handlers}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          togglePin(stage.id);
        } else if (event.key === "Escape" && pinned !== null) {
          togglePin(pinned);
        }
      }}
    >
      <desc>{plainText(stage.summary)}</desc>
      <rect
        className="pipeline__shape"
        x={left}
        y={top}
        width={box.width}
        height={box.height}
        rx={stage.kind === "step" ? 1.5 : stage.kind === "input" ? 4 : 10}
      />
      {stage.owner === "playground" ? (
        <path className="pipeline__notch" d={`M${left + 1} ${top + 1}h8l-8 8z`} />
      ) : null}
      {isPinned ? <circle className="pipeline__pin" cx={left + box.width - 8} cy={top + 8} r={3} /> : null}
      <text className="pipeline__label" x={box.x} y={box.y + labelDy} textAnchor="middle">
        {stage.label}
      </text>
      <text className="pipeline__note" x={box.x} y={box.y + noteDy} textAnchor="middle">
        {stage.note}
      </text>
    </g>
  );
};
