import React, { FC } from "react";
import { useRecoilValue } from "recoil";

import * as sceneState from "../state/SceneState";

/**
 * Create a baseplate that scales with agents as they move, based on the agents
 * furthest from the center of the map.
 */
export const ViewerStage: FC = () => {
  // A Square grid centered around the middle of the agents
  const dims = useRecoilValue(sceneState.StageDimensions);
  const showGrid = useRecoilValue(sceneState.GridEnabled);
  const showFloor = useRecoilValue(sceneState.FloorEnabled);
  const showAxes = useRecoilValue(sceneState.AxesEnabled);
  const stageColor = useRecoilValue(sceneState.StageColor);
  const gridColor = useRecoilValue(sceneState.GridColor);

  // Position of the grid to the center of the min/max
  const { pxMax, pxMin, pyMax, pyMin } = dims;
  const [[centerX, centerY], width] = getStagePlacement(
    pxMax,
    pxMin,
    pyMax,
    pyMin,
  );

  return (
    <>
      <gridHelper
        args={[width, width > 100 ? width / 2 : width, gridColor, gridColor]}
        rotation={[Math.PI / 2, Math.PI / 2, 0]}
        position={[centerX, centerY, 0]}
        visible={showGrid}
      />

      <mesh
        scale={[width + 1, width + 1, 0.01]}
        up={[0, 0, 1]}
        receiveShadow={true}
        position={[centerX, centerY, -0.1]}
        visible={showFloor}
      >
        <planeBufferGeometry attach="geometry" args={[1, 1]} />
        <meshPhongMaterial
          attach="material"
          color={stageColor}
          reflectivity={0}
          shininess={0}
          polygonOffset={true}
          polygonOffsetFactor={1}
          polygonOffsetUnits={0.01}
        />
      </mesh>

      <axesHelper args={[5]} visible={showAxes} />
    </>
  );
};

function getStagePlacement(
  pxMax: number,
  pxMin: number,
  pyMax: number,
  pyMin: number,
) {
  const center: [number, number] = [
    Math.floor((pxMax + pxMin) / 2),
    Math.floor((pyMax + pyMin) / 2),
  ];
  const width = Math.floor(Math.max(pxMax - pxMin, pyMax - pyMin));
  return [center, width] as const;
}
