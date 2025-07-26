import React, { FC, Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { useRecoilValue } from "recoil";

import { AgentMesh } from "./AgentMesh";
import { PositionedMeshes } from "../state/SceneState";
import { RenderSummary } from "../util/anim";

interface AgentRendererProps {
  mappedTransitions: RenderSummary;
}

export const AgentRenderer: FC<AgentRendererProps> = ({
  mappedTransitions,
}) => {
  /*
  Agent Animations
  ---
  1. Convert the list of agents to a map of agent_id -> agent_transition (in Agent Scene)
    - Agent transitions determine the "from" and "to" positions for animating
  2. Sort the agent transitions by mesh type to create a dedicated instanced mesh
  3. On each frame, lerp the positions of the transitions forward

  Hovered + Picked agents
  ---
  1. Instance a new selected mesh from basic box buffer geometry
  2. Pull in the list of IDs from the
  3. On each frame, follow the agenst as they move
  */

  // Group the transition map by mesh
  const positionedMeshes = useRecoilValue(PositionedMeshes);

  const clock = useRef<THREE.Clock>();
  if (!clock.current) {
    clock.current = new THREE.Clock();
  }

  const renderClock = useMemo(() => {
    return {
      lastTime: performance.now(),
      animLength: clock.current!.getDelta() * 1000,
    };
  }, [mappedTransitions]);

  // TODO Draw the message map as a network
  // Use the mesh map we generated to draw the agents
  return (
    <>
      {Object.keys(positionedMeshes).map((meshId) => (
        <Suspense fallback={null} key={meshId}>
          <AgentMesh meshId={meshId} clock={renderClock} />
        </Suspense>
      ))}

      <Suspense fallback={null}>
        <AgentMesh meshId={"pickedAgent"} clock={renderClock} />
      </Suspense>
    </>
  );
};
