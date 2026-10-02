import { useId } from "react";

import { PipelineEdge } from "./pipeline-graph/pipeline-edge";
import { PipelineNode } from "./pipeline-graph/pipeline-node";
import { PIPELINE_EDGES, PIPELINE_VIEWBOX, edgeFocus, edgeLine, nodeBox } from "./pipeline-layout";
import { useStageFocus } from "./stage-focus";

import type { StageWithSample } from "./stage-sample";

import "./pipeline-graph.css";

type PipelineGraphProps = {
  /** Every stage in pipeline order, with how it fared on the example. */
  samples: readonly StageWithSample[];
};

/**
 * Every part of the compilation as one graph: documents, steps and side
 * inputs joined by arrows, laid out by hand and scaled to the panel. A
 * hover focuses a stage, lighting it and its edges and dimming the rest; a
 * click pins it. Each stage also shows how it fared on the example: the
 * one that refused it in red, the ones it never reached faded.
 */
export const PipelineGraph: React.FC<PipelineGraphProps> = ({ samples }) => {
  const { focused } = useStageFocus();
  const id = useId();
  const markers = { rest: `${id}-arrow`, lit: `${id}-arrow-lit` };
  const { x, y, width, height } = PIPELINE_VIEWBOX;

  return (
    <div className="pipeline" data-focused={focused !== null}>
      <ul className="pipeline__legend" aria-label="Legend">
        <li data-kind="data">document</li>
        <li data-kind="step">step</li>
        <li data-kind="input">side input</li>
        <li data-kind="playground">added by the playground</li>
        <li data-kind="refused">refused</li>
        <li data-kind="idle">not reached</li>
      </ul>
      <svg
        className="pipeline__svg"
        viewBox={`${x} ${y} ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="The compilation pipeline"
      >
        <defs>
          {[
            { markerId: markers.rest, className: "pipeline__arrow" },
            { markerId: markers.lit, className: "pipeline__arrow pipeline__arrow--lit" },
          ].map(({ markerId, className }) => (
            <marker
              key={markerId}
              id={markerId}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path className={className} d="M0 0.5L7.5 4L0 7.5z" />
            </marker>
          ))}
        </defs>
        {PIPELINE_EDGES.map((edge) => (
          <PipelineEdge
            key={`${edge.from}-${edge.to}`}
            line={edgeLine(nodeBox(edge.from), nodeBox(edge.to))}
            state={edgeFocus(edge, focused)}
            label={edge.label}
            labelAt={edge.labelAt}
            labelSide={edge.labelSide}
            absent={edge.absent}
            markers={markers}
          />
        ))}
        {samples.map(({ stage, sample }) => (
          <PipelineNode
            key={stage.id}
            stage={stage}
            box={nodeBox(stage.id)}
            tone={sample.tone}
          />
        ))}
      </svg>
    </div>
  );
};
