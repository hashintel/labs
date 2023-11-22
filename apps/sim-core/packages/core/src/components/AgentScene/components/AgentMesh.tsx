import React, { FC, useRef } from "react";
import { useFrame } from "react-three-fiber";
import usePromise from "react-promise-suspense";
import * as THREE from "three";
import { BufferGeometry, InstancedBufferAttribute } from "three";
import { useRecoilState, useRecoilValue } from "recoil";

import * as sceneState from "../state/SceneState";
import { RawGeometry, loadGeometryMesh } from "../util/geometry-loader";
import { lerpAnimValue } from "../util/anim";

interface PolyMeshProps {
  meshId: string;
  clock: {
    lastTime: number;
    animLength: number;
  };
}
const tempObject = new THREE.Object3D();
tempObject.up = new THREE.Vector3(0, 0, 1);

/**
 * Create an instanced mesh based on a mesh ID and the number of agents
 *
 * Run through this current state looking for agents with a mesh type, drawing that mesh
 */
export const AgentMesh: FC<PolyMeshProps> = ({ meshId, clock }) => {
  const ref = useRef<THREE.InstancedMesh>();

  const [hoveredAgentId, setHoveredAgentIds] = useRecoilState(
    sceneState.HoveredAgent,
  );
  const [selectedAgentIds, setSelectedAgentIds] = useRecoilState(
    sceneState.SelectedAgentIds,
  );

  // Only update the render agents when agents changes
  const renderAgents =
    useRecoilValue(sceneState.ShapedMeshesEntries(meshId)) ?? {};
  const numMeshes = renderAgents.length;
  const bufferedMeshCount = getMeshCount(numMeshes, meshId);

  // meshId should only initialize at the beginning of the component mount
  const [geometry, material]: RawGeometry = usePromise(loadGeometryMesh, [
    meshId,
    bufferedMeshCount,
  ]);

  const { lastTime, animLength } = clock;

  // Render the meshes and react to user input (like hover/picking/etc)
  useFrame(() => {
    // We know that the color buffer is a BufferGeometry, but that specificiy
    // is lost when injected into three. Our casting is a type narrowing
    const colorBuffer = (ref.current!.geometry as BufferGeometry).getAttribute(
      "color",
    ) as InstancedBufferAttribute | undefined;

    const lerpVal =
      animLength > 2000
        ? 1
        : Math.min((performance.now() - lastTime) / animLength, 1);

    let agentIdx = 0;
    for (const [_, agent] of renderAgents) {
      if (agent.position && !agent.hidden) {
        // 1. Scale
        const [scalex, scaley, scalez] = lerpAnimValue(agent.scale, lerpVal);
        tempObject.scale.set(scalex, scaley, scalez);

        /*
         2. Direction
         We cheat a little to set the direction.
         The agent's "direction" is relative to its own axis.
         We can temporarily have that be true, if its position shares the same as the world.
         So we set its position to just below 0, look at the same direction, and then move it.
         */
        const [dirx, diry, dirz] = lerpAnimValue(agent.direction, lerpVal);
        tempObject.position.set(-0.00001, 0, 0);

        // The alignment here is a bit quirky and was only figured out empirically
        // lookAt orients the internal Z axis, but we actually care about the internal X axis
        // This means we need to flip the agent back up around its internal X axis after orienting
        // A less lazy version of this would be to manually craft the matrix4 transform from
        // the position and rotation vectors
        tempObject.lookAt(dirx, diry, dirz);
        tempObject.rotateX((3 * Math.PI) / 2);

        // 3. Position
        const [posx, posy, posz] = lerpAnimValue(agent.position, lerpVal);
        const adjustedZ = posz + (agent.useHeight ? scalez / 2 : 0);
        tempObject.position.set(posx, posy, adjustedZ);

        // 4. Color
        const [colorR, colorG, colorB] = lerpAnimValue(agent.color, lerpVal);
        colorBuffer?.setXYZ(agentIdx, colorR, colorG, colorB);

        // Commit our changes to the agent
        tempObject.updateMatrix();
        ref.current!.setMatrixAt(agentIdx, tempObject.matrix);
        agentIdx++;
      }
    }

    // For any meshes we haven't covered yet, scale them back to 0 so we don't see them
    for (let matrixIdx = agentIdx; matrixIdx < bufferedMeshCount; matrixIdx++) {
      tempObject.scale.set(0, 0, 0);
      tempObject.updateMatrix();
      ref.current!.setMatrixAt(matrixIdx, tempObject.matrix);
    }

    // Required by ThreeJS to commit changes back to the GPU
    ref.current!.instanceMatrix.needsUpdate = true;

    // Make sure to update the color buffer if this mesh has it
    if (colorBuffer) {
      colorBuffer.needsUpdate = true;
    }
  });

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, bufferedMeshCount]}
      up={[0, 0, 1]}
      // The agent is being hovered over, pass this on to the setter
      onPointerMove={(evt) => {
        const id = evt.instanceId;
        if (id !== undefined && renderAgents[id]) {
          const [agentId] = renderAgents[id];
          if (agentId !== hoveredAgentId) {
            setHoveredAgentIds(agentId);
          }
        }
      }}
      // Agent is being clicked
      onPointerDown={(evt) => {
        const id = evt.instanceId;
        // https://stackoverflow.com/questions/16220913/accessing-right-click-with-three-js/16221232
        if (id !== undefined && !evt.ctrlKey && evt.button === 0) {
          const [agentId] = renderAgents[id];
          const temp = { ...selectedAgentIds };

          if (selectedAgentIds.hasOwnProperty(agentId)) {
            delete temp[agentId];
            setSelectedAgentIds(temp);
          } else {
            temp[agentId] = true;
            setSelectedAgentIds(temp);
          }
        }
      }}
      onPointerOut={() => {
        setHoveredAgentIds(null);
      }}
    />
  );
};

/**
 * Returns a number power-log number of meshes based on how many agents exist
 */
const getMeshCount = (numMeshes: number, meshId: string) => {
  const { ceil, log, pow } = Math;
  const newMeshSize = pow(2, ceil(log(numMeshes) / log(2)));

  // We pre-cache more cubes if the simulation specifies a common shape than we do for other shapes
  const cappedMeshCount = Math.max(newMeshSize, meshId === "box" ? 128 : 32);
  return cappedMeshCount;
};
