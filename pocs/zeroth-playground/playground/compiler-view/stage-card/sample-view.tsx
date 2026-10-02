import type { StageSample } from "../stage-sample";

type SampleViewProps = {
  exampleTitle: string;
  sample: StageSample;
};

/** What the stage made of the example in the editor: headline, values, and a few quoted lines. */
export const SampleView: React.FC<SampleViewProps> = ({ exampleTitle, sample }) => {
  const { excerpt } = sample;
  return (
    <section className="sample" data-tone={sample.tone} aria-label={`Live: ${exampleTitle}`}>
      <p className="kicker sample__kicker">Live · {exampleTitle}</p>
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
      {excerpt === undefined ? null : (
        <figure className="sample__excerpt">
          <figcaption className="sample__source">{excerpt.source}</figcaption>
          <pre>
            {excerpt.lines.map((line, index) => {
              const previous = excerpt.lines[index - 1];
              const skipped = previous !== undefined && line.number > previous.number + 1;
              return (
                <span key={line.number} className="sample__line" data-lit={line.lit} data-skipped={skipped}>
                  <span className="sample__number">{line.number}</span>
                  {line.text === "" ? " " : line.text}
                </span>
              );
            })}
          </pre>
        </figure>
      )}
    </section>
  );
};
