import { flushSync } from "react-dom";

import { focusById } from "./focus-handoff";
import { useStageFocus } from "./stage-focus";

import type { FocusHandoff } from "./focus-handoff";
import type { StageWithSample } from "./stage-sample";

import "./stage-card.css";
import "./stage-overview.css";

type StageOverviewProps = {
  exampleTitle: string;
  /** Every stage in pipeline order, with what it made of the example. */
  samples: readonly StageWithSample[];
  handoff: FocusHandoff;
};

/**
 * The card with no stage focused: every stage in pipeline order with what
 * it made of the example, one line each. A click pins the stage and moves
 * the keyboard focus to the card's "All stages", since the row goes away.
 */
export const StageOverview: React.FC<StageOverviewProps> = ({ exampleTitle, samples, handoff }) => {
  const { togglePin } = useStageFocus();
  return (
    <div className="stage-overview">
      <div className="stage-overview__intro prose">
        <p className="caps kicker">Overview</p>
        <h2 className="stage-card__title">{exampleTitle}, stage by stage</h2>
        <p className="stage-card__summary">
          Hover a stage in the graph or in the guide to open its card here; click to pin it.
        </p>
      </div>
      <ol className="stage-overview__list">
        {samples.map(({ stage, sample }, index) => (
          <li key={stage.id}>
            <button
              type="button"
              id={handoff.row(stage.id)}
              className="stage-overview__row"
              data-stage={stage.id}
              data-tone={sample.tone}
              onClick={() => {
                flushSync(() => togglePin(stage.id));
                focusById(handoff.back);
              }}
            >
              <span className="stage-overview__number">{String(index + 1).padStart(2, "0")}</span>
              <span className="stage-overview__name">{stage.title}</span>
              <span className="stage-overview__headline">{sample.headline}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
};
