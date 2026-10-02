import { edgeLabel } from "../pipeline-layout";

import type { EdgeLine, FocusState, LabelSide } from "../pipeline-layout";

type PipelineEdgeProps = {
  line: EdgeLine;
  state: FocusState;
  label?: string;
  /** Where along the line the label sits, 0 to 1. */
  labelAt?: number;
  labelSide?: LabelSide;
  absent?: boolean;
  /** The ids of the two arrowhead markers, at rest and lit. */
  markers: { rest: string; lit: string };
};

/**
 * One edge: a paper-coloured halo under the line, so a later edge crossing
 * an earlier one cuts a small gap in it, then the line with its arrowhead
 * and an optional label beside its middle.
 */
export const PipelineEdge: React.FC<PipelineEdgeProps> = ({
  line,
  state,
  label,
  labelAt,
  labelSide,
  absent = false,
  markers,
}) => {
  const placed = label === undefined ? null : edgeLabel(line, labelAt, labelSide);
  return (
    <g className="pipeline__edge" data-state={state} data-absent={absent}>
      <line className="pipeline__halo" {...line} />
      <line
        className="pipeline__line"
        {...line}
        markerEnd={`url(#${state === "focus" ? markers.lit : markers.rest})`}
      />
      {placed === null ? null : (
        <text className="pipeline__edge-label" x={placed.x} y={placed.y} textAnchor={placed.anchor}>
          {label}
        </text>
      )}
    </g>
  );
};
