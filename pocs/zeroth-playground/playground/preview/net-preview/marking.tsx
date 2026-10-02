import type { LaidOutNode, Point } from "../layout-net";

/** The most tokens drawn as dots; a larger count is written as a number. */
const MAX_DOTS = 4;

/** Token dots for a small count, the number for a larger one. */
export const Marking: React.FC<{ node: LaidOutNode }> = ({ node }) => {
  if (node.kind !== "place" || node.tokens === 0) {
    return null;
  }
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  if (node.tokens > MAX_DOTS) {
    return (
      <text className="net__count" x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
        {node.tokens}
      </text>
    );
  }
  const offsets: Point[] =
    node.tokens === 1
      ? [{ x: 0, y: 0 }]
      : node.tokens === 2
        ? [{ x: -6, y: 0 }, { x: 6, y: 0 }]
        : node.tokens === 3
          ? [{ x: -6, y: 4 }, { x: 6, y: 4 }, { x: 0, y: -6 }]
          : [{ x: -6, y: -6 }, { x: 6, y: -6 }, { x: -6, y: 6 }, { x: 6, y: 6 }];
  return (
    <g className="net__tokens">
      {offsets.map((offset, index) => (
        <circle key={index} cx={cx + offset.x} cy={cy + offset.y} r={3.5} />
      ))}
    </g>
  );
};
