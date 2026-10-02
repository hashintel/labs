import { use } from "react";

import { layoutFor, placeGraph } from "../layout-net";
import { ArcView } from "./arc-view";
import { NodeView } from "./node-view";

import type { NetItem } from "../../../compiler";
import type { NetGraph } from "../net-graph";

type DrawingProps = {
  graph: NetGraph;
  /** The net item lit by a hover in any view. */
  lit: NetItem | null;
  onHover: (source: NetItem | null) => void;
};

/** How far past its laid-out size the drawing may grow to fill the panel. */
const SCALE_CAP = 1.6;

/** The laid-out net as one SVG, scaled to fit. It suspends while elkjs lays the graph out. */
export const Drawing: React.FC<DrawingProps> = ({ graph, lit, onHover }) => {
  const layout = placeGraph(graph, use(layoutFor(graph)));
  if (layout.nodes.length === 0) {
    return <p className="note">The net has no places or transitions yet.</p>;
  }
  return (
    <svg
      className="net"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ maxWidth: layout.width * SCALE_CAP, maxHeight: layout.height * SCALE_CAP }}
      role="img"
      aria-label="The net: places as circles, transitions as squares"
    >
      <defs>
        <marker
          id="net-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
        <marker
          id="net-inhibit"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto"
        >
          <circle cx="5" cy="5" r="3.5" className="net__inhibit" />
        </marker>
      </defs>
      {layout.edges.map((edge) => (
        <ArcView key={edge.id} edge={edge} lit={lit} />
      ))}
      {layout.nodes.map((node) => (
        <NodeView key={node.id} node={node} lit={lit} onHover={onHover} />
      ))}
    </svg>
  );
};
