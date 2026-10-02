import type { NetItem } from "../../../compiler";
import type { LaidOutEdge, Point } from "../layout-net";

type ArcViewProps = {
  edge: LaidOutEdge;
  /** The net item lit by a hover in any view. */
  lit: NetItem | null;
};

/** An arc lights with either of its ends. */
function edgeLit(edge: LaidOutEdge, lit: NetItem | null): boolean {
  return (
    lit !== null &&
    ((lit.kind === "place" && lit.name === edge.place) ||
      (lit.kind === "transition" && lit.name === edge.transition))
  );
}

function midpoint(points: Point[]): Point {
  const middle = Math.floor((points.length - 1) / 2);
  const from = points[middle] ?? { x: 0, y: 0 };
  const to = points[middle + 1] ?? from;
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

/** An arc as an arrow, or a line ending in a circle for an inhibitor arc, with a weight other than one over its middle. */
export const ArcView: React.FC<ArcViewProps> = ({ edge, lit }) => {
  if (edge.points.length < 2) {
    return null;
  }
  const label = midpoint(edge.points);
  return (
    <g className="net__arc" data-kind={edge.kind} data-lit={edgeLit(edge, lit)}>
      <polyline
        className="net__line"
        points={edge.points.map((point) => `${point.x},${point.y}`).join(" ")}
        markerEnd={edge.kind === "inhibitor" ? "url(#net-inhibit)" : "url(#net-arrow)"}
      />
      {edge.weight === 1 ? null : (
        <text className="net__weight" x={label.x} y={label.y - 4} textAnchor="middle">
          {edge.weight}
        </text>
      )}
    </g>
  );
};
