import { useState } from "react";

import {
  type Timeline as TimelineData,
  type TimelineRow,
  axisOf,
  columnAt,
  describeStep,
  formatNumber,
  metricPlotRange,
  metricRange,
  windowColumns,
} from "./timeline-model";

import "./timeline.css";

type TimelineProps = {
  timeline: TimelineData;
  /** The step the verdict was decided at; `undefined` when it holds only at the end of the run. */
  decidedAt: number | undefined;
  /** The verdict is not pending, so a decision at the end of the run is marked on the last state. */
  final: boolean;
  /** The rule's win condition, its conditions in code between backticks. */
  pass: string;
  /** The conditions a hover has lit, by canonical text; their rows light up. */
  linked?: readonly string[];
  /** A hover on a row reports the conditions it stands for; leaving it reports `null`. */
  onLink?: (keys: string[] | null) => void;
};

const NO_KEYS: readonly string[] = [];

/** The height of a condition or verdict strip and of a metric strip, in SVG units; a strip is as wide as it has columns. */
const ROW_HEIGHT = 14;
const METRIC_HEIGHT = 30;
/** Space kept above and below a metric's line, so its extremes are not cut at the edge. */
const METRIC_PAD = 2;

/** Each row's height in the grid, so the labels, the scales and the strips line up. */
function rowTemplate(rows: TimelineRow[]): React.CSSProperties {
  return {
    gridTemplateRows: rows.map((row) => `var(--${row.kind === "metric" ? "metric" : "row"}-height)`).join(" "),
  };
}

/** Where a value sits in a metric's strip, in SVG units from the top: the plot range between the pads, a flat metric halfway. */
function metricY(row: Extract<TimelineRow, { kind: "metric" }>, value: number): number {
  const range = metricPlotRange(row);
  const low = range?.low ?? 0;
  const span = (range?.high ?? 0) - low;
  return span === 0 ? METRIC_HEIGHT / 2 : METRIC_HEIGHT - METRIC_PAD - ((value - low) / span) * (METRIC_HEIGHT - 2 * METRIC_PAD);
}

/** Whether a row stands for one of the lit conditions. */
function isLinked(row: TimelineRow, linked: readonly string[]): boolean {
  return row.kind !== "verdict" && (row.link?.some((key) => linked.includes(key)) ?? false);
}

type StripProps = {
  row: TimelineRow;
  count: number;
  hovered: number | null;
  linked: boolean;
  onLink: (keys: string[] | null) => void;
};

/** One row's strip: coloured cells for a condition and the verdict, or a line over dashed thresholds for a metric. */
const Strip: React.FC<StripProps> = ({ row, count, hovered, linked, onLink }) => {
  const height = row.kind === "metric" ? METRIC_HEIGHT : ROW_HEIGHT;
  let drawing: React.ReactNode;
  if (row.kind === "metric") {
    const y = (value: number) => metricY(row, value);
    const points = row.values
      .flatMap((value, index) => (value === null ? [] : [`${index + 0.5},${y(value).toFixed(2)}`]))
      .join(" ");
    drawing = (
      <>
        {row.thresholds.map((threshold) => (
          <line
            key={threshold}
            className="timeline__threshold"
            x1={0}
            x2={count}
            y1={y(threshold)}
            y2={y(threshold)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polyline className="timeline__line" points={points} vectorEffect="non-scaling-stroke" />
      </>
    );
  } else {
    drawing = row.values.map((value, index) => (
      <rect
        key={index}
        className="timeline__cell"
        data-value={String(value)}
        x={index}
        y={0}
        width={1}
        height={height}
        shapeRendering="crispEdges"
      />
    ));
  }
  return (
    <svg
      className="timeline__strip"
      data-linked={linked}
      onPointerEnter={() => onLink(row.kind === "verdict" ? null : (row.link ?? null))}
      viewBox={`0 0 ${count} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {drawing}
      {hovered === null ? null : <rect className="timeline__cursor" x={hovered} y={0} width={1} height={height} />}
    </svg>
  );
};

/** A metric row's largest and smallest value, as its y-scale, the largest at the height of the line's top; the other rows leave the cell empty. */
const Scale: React.FC<{ row: TimelineRow; linked: boolean }> = ({ row, linked }) => {
  const range = row.kind === "metric" ? metricRange(row) : null;
  return (
    <li className="timeline__scale" data-linked={linked}>
      {range === null || row.kind !== "metric" ? null : (
        <>
          <span style={{ top: `${(metricY(row, range.high) / METRIC_HEIGHT) * 100}%` }}>{formatNumber(range.high)}</span>
          {range.high === range.low ? null : <span style={{ bottom: 0 }}>{formatNumber(range.low)}</span>}
        </>
      )}
    </li>
  );
};

/**
 * The run as strips: one row per number, condition and the rule so far, one
 * column per state, under a colour key and over a step axis. The pointer over
 * the strips picks a state, and the line under them says what that state is.
 */
export const Timeline: React.FC<TimelineProps> = ({ timeline, decidedAt, final, pass, linked = NO_KEYS, onLink = () => {} }) => {
  const [hovered, setHovered] = useState<number | null>(null);
  const count = timeline.steps.length;
  const atEnd = decidedAt === undefined && final;
  const decidedColumn = atEnd
    ? count - 1
    : decidedAt === undefined
      ? -1
      : timeline.steps.findIndex((info) => info.step === decidedAt);
  const decidedStep = timeline.steps[decidedColumn]?.step;
  const band = windowColumns(timeline);
  const axis = axisOf(timeline);
  const template = rowTemplate(timeline.rows);

  function point(event: React.PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    setHovered(columnAt(event.clientX - box.left, box.width, count));
  }

  return (
    <div className="timeline">
      <p className="timeline__key">
        <span className="timeline__swatch" data-tone="holds" aria-hidden="true" />
        holds
        <span className="timeline__swatch" data-tone="broken" aria-hidden="true" />
        broken
        <span className="timeline__swatch" data-tone="open" aria-hidden="true" />
        not decided yet
        {band === null || timeline.window === undefined ? null : (
          <>
            <span className="timeline__swatch" data-tone="window" aria-hidden="true" />
            time window {formatNumber(timeline.window.from)} to {formatNumber(timeline.window.to)}
          </>
        )}
      </p>
      <div className="timeline__grid" onPointerLeave={() => onLink(null)}>
        <ul className="timeline__labels" style={template}>
          {timeline.rows.map((row) => (
            <li
              key={`${row.kind}-${row.label}`}
              className="timeline__label"
              title={row.label}
              data-linked={isLinked(row, linked)}
              onPointerEnter={() => onLink(row.kind === "verdict" ? null : (row.link ?? null))}
            >
              {row.label}
            </li>
          ))}
        </ul>
        <ul className="timeline__scales" style={template} aria-hidden="true">
          {timeline.rows.map((row) => (
            <Scale key={`${row.kind}-${row.label}`} row={row} linked={isLinked(row, linked)} />
          ))}
        </ul>
        <div className="timeline__strips" style={template} onPointerMove={point} onPointerLeave={() => setHovered(null)}>
          {band === null ? null : (
            <div
              className="timeline__window"
              style={{ left: `${(band.first / count) * 100}%`, width: `${((band.last - band.first + 1) / count) * 100}%` }}
            />
          )}
          {timeline.rows.map((row) => (
            <Strip key={`${row.kind}-${row.label}`} row={row} count={count} hovered={hovered} linked={isLinked(row, linked)} onLink={onLink} />
          ))}
          {decidedColumn < 0 ? null : (
            <div
              className="timeline__decided"
              style={{ left: `${((decidedColumn + 0.5) / count) * 100}%`, "--cell": `${100 / count}%` } as React.CSSProperties}
            />
          )}
        </div>
      </div>
      {axis === null ? null : (
        <div className="timeline__under">
          <div className="timeline__axis">
            <span>{axis.times === null ? axis.first : `${axis.first} · ${axis.times.first}`}</span>
            <span>{axis.times === null ? axis.last : `${axis.last} · ${axis.times.last}`}</span>
          </div>
          {decidedColumn < 0 ? null : (
            <div className="timeline__decided-row">
              <span
                className="timeline__decided-label"
                data-late={decidedColumn > count / 2}
                style={{ left: `${((decidedColumn + 0.5) / count) * 100}%` }}
              >
                decided at step {decidedStep}
                {atEnd ? " (end of run)" : ""}
              </span>
            </div>
          )}
        </div>
      )}
      <p className="timeline__pass">
        {pass.split("`").map((part, index) =>
          index % 2 === 1 ? (
            <code key={index} className="timeline__code">
              {part}
            </code>
          ) : (
            part
          ),
        )}
      </p>
      <p className="timeline__readout" aria-live="off">
        {hovered === null ? "Point at a state to read it." : describeStep(timeline, hovered)}
      </p>
    </div>
  );
};
