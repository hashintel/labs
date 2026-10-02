import { sameItem } from "../../../compiler";
import { nodeSource } from "../net-graph";
import { Marking } from "./marking";

import type { NetItem } from "../../../compiler";
import type { LaidOutNode } from "../layout-net";

type NodeViewProps = {
  node: LaidOutNode;
  /** The net item lit by a hover in any view. */
  lit: NetItem | null;
  onHover: (source: NetItem | null) => void;
};

/** The line under a node's name: a place's colour and capacity, a transition's rate and guard. */
function nodeDetail(node: LaidOutNode): string | null {
  const parts =
    node.kind === "place"
      ? [
          ...(node.colour === undefined ? [] : [node.colour]),
          ...(node.capacity === undefined ? [] : [`≤ ${node.capacity}`]),
        ]
      : [
          ...(node.rate === undefined ? [] : [`λ ${node.rate === "code" ? "code" : node.rate}`]),
          ...(node.guarded ? ["guard"] : []),
        ];
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * A place as a circle with its marking, or a transition as a square, dashed
 * when it is controllable, with its name and detail under it. Hovering it
 * reports the item it stands for.
 */
export const NodeView: React.FC<NodeViewProps> = ({ node, lit, onHover }) => {
  const cx = node.x + node.width / 2;
  const detail = nodeDetail(node);
  return (
    <g
      className="net__node"
      data-kind={node.kind}
      data-lit={lit !== null && sameItem(lit, nodeSource(node))}
      onMouseEnter={() => onHover(nodeSource(node))}
      onMouseLeave={() => onHover(null)}
    >
      {node.kind === "place" ? (
        <circle className="net__shape" cx={cx} cy={node.y + node.height / 2} r={node.width / 2} />
      ) : (
        <rect
          className="net__shape"
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          strokeDasharray={node.controllable ? "4 3" : undefined}
        />
      )}
      <Marking node={node} />
      <text className="net__label" x={cx} y={node.y + node.height + 13} textAnchor="middle">
        {node.name}
      </text>
      {detail === null ? null : (
        <text className="net__detail" x={cx} y={node.y + node.height + 24} textAnchor="middle">
          {detail}
        </text>
      )}
    </g>
  );
};
