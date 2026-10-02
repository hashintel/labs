import { flushSync } from "react-dom";

import { focusById } from "./focus-handoff";
import { RichText } from "./rich-text";
import { SampleView } from "./stage-card/sample-view";
import { useStageFocus } from "./stage-focus";

import type { FocusHandoff } from "./focus-handoff";
import type { StageSample } from "./stage-sample";
import type { Stage } from "./stages";

type StageCardProps = {
  stage: Stage;
  sample: StageSample;
  exampleTitle: string;
  handoff: FocusHandoff;
};

const KIND_LABELS: Record<Stage["kind"], string> = {
  data: "Document",
  step: "Step",
  input: "Side input",
};

const OWNER_LABELS: Record<Stage["owner"], string> = {
  compiler: "compiler",
  playground: "playground",
};

/**
 * The focused stage: what it is, its call, what goes in and comes out, the
 * facts worth knowing, and beside them what it made of the example.
 */
export const StageCard: React.FC<StageCardProps> = ({ stage, sample, exampleTitle, handoff }) => {
  const { pinned, togglePin } = useStageFocus();
  const [from, to] = stage.kind === "step" ? ["In", "Out"] : ["From", "To"];
  return (
    <div className="stage-card">
      <article className="stage-card__doc">
        <div className="stage-card__head">
          {pinned === null ? null : (
            <button
              type="button"
              id={handoff.back}
              className="stage-card__back"
              onClick={() => {
                // The button goes with the card: hand the focus to the stage's row in the overview.
                flushSync(() => togglePin(pinned));
                focusById(handoff.row(pinned));
              }}
            >
              <span className="stage-card__back-chevron" aria-hidden="true" />
              All stages
            </button>
          )}
          <p className="kicker">
            {KIND_LABELS[stage.kind]} · {OWNER_LABELS[stage.owner]}
          </p>
        </div>
        <h2 className="stage-card__title">{stage.title}</h2>
        <p className="stage-card__summary">
          <RichText text={stage.summary} />
        </p>
        <pre className="stage-card__call">{stage.call}</pre>
        <dl className="stage-card__io">
          <dt>{from}</dt>
          <dd>
            <RichText text={stage.input} />
          </dd>
          <dt>{to}</dt>
          <dd>
            <RichText text={stage.output} />
          </dd>
        </dl>
        <ul className="stage-card__details">
          {stage.details.map((detail) => (
            <li key={detail}>
              <RichText text={detail} />
            </li>
          ))}
        </ul>
      </article>
      <SampleView exampleTitle={exampleTitle} sample={sample} />
    </div>
  );
};
