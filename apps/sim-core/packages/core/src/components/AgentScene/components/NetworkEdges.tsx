import React, { FC, useMemo } from "react";
import { ArrowHelper, Vector3 } from "three";
import { useRecoilValue } from "recoil";

import * as sceneState from "../state/SceneState";
import { RenderSummary } from "../util/anim";

interface NetworkEdgesProps {
  mappedTransitions: RenderSummary;
}

// Arguments for constructing THREE arrowHelper
type ArrowConstructorArgs = typeof ArrowHelper extends new (
  ...args: infer U
) => any
  ? U
  : never;

interface ArrowData {
  key: string;
  args: ArrowConstructorArgs;
}

/**
 * Convert the array vector in agent state to a THREE Vector3
 * and place the line's origin/destination in the center of 1x1 boxes.
 * a fuller solution would take account of the agent's full dimensions
 * to determine the best placement for the line.
 * */
const arrayToVector3 = (vector: [number, number, number]) =>
  new Vector3(vector[0], vector[1], vector[2] + 0.5);

/** Don't trust the user's input */
const isValidNetworkArray = (value: unknown): value is string[] =>
  Array.isArray(value) && typeof value[0] === "string";

/**
 * Draw a line from each agent to its neighbors if it's part of a network.
 * The relationship may be directed, in which case an arrow indicates the direction.
 * @todo Animate the transition between an arrow's previous position and its new one. Can use AgentMesh's useFrame (specifically, the position section) as a reference.
 */
export const NetworkEdges: FC<NetworkEdgesProps> = ({ mappedTransitions }) => {
  // Which agents are hovered or selected? We'll highlight connected lines
  const hoveredAgentId = useRecoilValue(sceneState.HoveredAgent);
  const selectedAgents = useRecoilValue(sceneState.SelectedAgentIds);
  const selectedAgentIds = Object.keys(selectedAgents);
  const highlightedAgents = [hoveredAgentId, ...selectedAgentIds].filter(
    Boolean,
  );

  const arrowData: ArrowData[] = useMemo(() => {
    const data: ArrowData[] = [];

    // Track relationships we've handled, as they're mirrored on both agents.
    // We want to avoid drawing the same arrow or line twice.
    const handledUndirectedRelationships = new Set<string>();

    for (const [agentId, agent] of Object.entries(mappedTransitions)) {
      const {
        network_neighbor_out_ids,
        network_neighbor_ids,
        position,
        remove,
      } = agent;

      // If agent is being removed, don't draw edges from it
      if (remove) {
        continue;
      }

      /**
       * We only check the undirected and the out_ids.
       * There is also an in_ids field, but it mirrors the out_ids.
       */
      const networkNeighborMap = {
        undirected: network_neighbor_ids,
        out: network_neighbor_out_ids,
      };

      for (const [relationship, neighborList] of Object.entries(
        networkNeighborMap,
      )) {
        if (!isValidNetworkArray(neighborList)) {
          continue;
        }
        for (const neighborId of neighborList) {
          const relationshipId = [agentId, neighborId].sort().join("-");

          // Check + set whether we've handled an undirected relationship
          if (relationship === "undirected") {
            if (handledUndirectedRelationships.has(relationshipId)) {
              continue;
            }
            handledUndirectedRelationships.add(relationshipId);
          }

          // Check the neighbor exists and isn't scheduled for removal
          const neighbor = mappedTransitions[neighborId];
          if (!neighbor || neighbor.remove) {
            continue;
          }

          // Configure the arrow
          const origin = arrayToVector3(position.to);
          const destination = arrayToVector3(neighbor.position.to);
          const direction = new Vector3()
            .subVectors(destination, origin)
            .normalize();
          const length = origin.distanceTo(destination) - 0.5;

          // Highlight edges connected to the hovered or selected agent(s)
          const hovered = highlightedAgents.find(
            (id) => id === agentId || id === neighborId,
          );
          const color = hovered ? 0xffffff : 0xfc03e8;

          // If the relationship is undirected, don't show an arrowhead.
          // If the agent is hovered/selected, show a bigger arrowhead.
          const arrowSize =
            relationship === "undirected" ? 0 : hovered ? 0.4 : 0.3;

          const key = `${agentId}-${neighborId}-${relationship}`;
          const args: ArrowConstructorArgs = [
            direction,
            origin,
            length,
            color,
            arrowSize,
            arrowSize,
          ];
          data.push({ args, key });
        }
      }
    }
    return data;
  }, [highlightedAgents, mappedTransitions]);

  return (
    <>
      {arrowData.map(({ key, args }) => (
        // eslint-disable-next-line react/no-unknown-property
        <arrowHelper args={args} key={key} />
      ))}
    </>
  );
};
