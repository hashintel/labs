import { CodeExcerpt } from "../../ui/code-excerpt";

import type { StageSample } from "../stage-sample";

import "./sample-view.css";

type SampleViewProps = {
  exampleTitle: string;
  sample: StageSample;
};

/** What the stage made of the example in the editor: headline, values, and a few quoted lines. */
export const SampleView: React.FC<SampleViewProps> = ({ exampleTitle, sample }) => {
  const { excerpt } = sample;
  return (
    <section className="sample" data-tone={sample.tone} aria-label={`Live: ${exampleTitle}`}>
      <p className="caps kicker">Live · {exampleTitle}</p>
      <p className="sample__headline">
        <span className="sample__dot" aria-hidden="true" />
        {sample.headline}
      </p>
      {sample.rows.length === 0 ? null : (
        <dl className="sample__rows">
          {sample.rows.map((row, index) => (
            <div key={`${row.label}-${index}`} className="sample__row" data-muted={row.muted ?? false} data-error={row.error ?? false}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {excerpt === undefined ? null : <CodeExcerpt excerpt={excerpt} />}
    </section>
  );
};
