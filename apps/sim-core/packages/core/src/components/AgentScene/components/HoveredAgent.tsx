import React, { FC } from "react";
import * as THREE from "three";
import { Vec3 } from "@hashintel/engine-web";
import { useRecoilState } from "recoil";

import * as sceneState from "../state/SceneState";
import { RenderSummary } from "../util/anim";

const tempObject = new THREE.Object3D();
tempObject.up = new THREE.Vector3(0, 0, 1);

type HoveredAgentProps = {
  transitions: RenderSummary;
};
/*
 * Creates the appropriate ThreeJS representation of a "hovered" agent
 */
export const HoveredAgent: FC<HoveredAgentProps> = ({ transitions }) => {
  const [hoveredAgentId] = useRecoilState(sceneState.HoveredAgent);

  if (hoveredAgentId) {
    // HoveredAgentID might be stale (cursor improperly focused and ID gets outdated)
    // Make sure it exsts before using it (might crash or reset)
    const agent = transitions[hoveredAgentId];
    if (agent && agent.original && agent.original.position) {
      const [scalex, scaley, scalez] = agent.scale.to;
      const scale: Vec3 = [scalex * 1.05, scaley * 1.05, scalez * 1.05];

      const offsetZ = agent.useHeight ? scalez / 2 : 0;

      const [dirx, diry, dirz]: Vec3 = agent.direction.to;

      tempObject.position.set(-0.00001, 0, 0);
      tempObject.lookAt(dirx, diry, dirz);
      tempObject.rotateX((3 * Math.PI) / 2);
      tempObject.updateMatrix();

      const [posx, posy, posz] = agent.position.to;
      const pos: Vec3 = [posx, posy, posz + offsetZ];

      return (
        <mesh
          scale={scale}
          position={pos}
          rotation={tempObject.rotation}
          up={[0, 0, 1]}
        >
          <boxBufferGeometry args={[1, 1, 1]} attach="geometry" />
          <meshStandardMaterial
            color={"white"}
            attach="material"
            wireframe={true}
          />
        </mesh>
      );
    }
  }
  return null;
};
