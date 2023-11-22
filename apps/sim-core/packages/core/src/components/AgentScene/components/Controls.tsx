import React, { FC, useEffect, useRef, useState } from "react";
import { CanvasProps, useThree } from "react-three-fiber";
import * as THREE from "three";
import { MapControls, OrbitControls } from "@react-three/drei";
import { useRecoilValue } from "recoil";

import * as sceneState from "../state/SceneState";
import { RenderSummary } from "../util/anim";

const cameraRot = new THREE.Object3D();

// Set its up vector to be used in the x-y plane with z height space
cameraRot.up = new THREE.Vector3(0, 0, 1);
cameraRot.position.set(200, -200, 200);
cameraRot.lookAt(0, 0, 0);
cameraRot.updateMatrix();

export const orthoCamera: Partial<CanvasProps["camera"]> = {
  position: cameraRot.position,
  rotation: cameraRot.rotation,
  near: 0.1,
  far: 300000,

  // FYI
  // The angle of the camera's aperture in degrees
  fov: 30,
};

// Set up the appropriate controls for the 3d viewer
export const ViewerControls: FC<{
  resetting: boolean;
  mappedTransitions: RenderSummary;
}> = ({ resetting, mappedTransitions }) => {
  const cameraFov = useRecoilValue(sceneState.CameraFov);
  const dimensions = useRecoilValue(sceneState.StageDimensions);
  const controlsRef = useRef<MapControls>();
  const view = useRecoilValue(sceneState.SceneView);
  const { camera } = useThree();

  /*
  Hook into the 2d/3d toggle in the settings pane
  */
  useEffect(() => {
    if (view === "3d") {
      // Reset the camera to the initial, or previous view
      controlsRef.current!.reset!();

      // Unlock the camera's rotation axes (set by 2d mode)
      controlsRef.current!.maxPolarAngle = Math.PI / 2;

      // Reset the cameraFov back to normal
      // Not sure why the "FOV" prop doesn't exist :hmm:
      (camera as any).fov = cameraFov;
      camera.updateProjectionMatrix();
    } else {
      // Save the current ortho camera to resume when we go back into 3d
      controlsRef.current!.saveState!();

      // Tell our controls to orient back to 0,0,0
      (controlsRef.current!.target as THREE.Vector3).set(0, 0, 0);

      // Lock down the rotation vector to prevent off-axis viewing
      // This lets the orientation of the plane move
      controlsRef.current!.maxPolarAngle = 0;

      // Disable the controls while we manually fiddle with the camera
      // If we don't, then the camera will update and mess with our changes
      controlsRef.current!.enabled = false;

      // Manually fiddle with the camera, making it centered high above 0,0 and
      // then orienting down by looking down
      camera.position.set(0, 0, 1000);
      camera.lookAt(0, 0, 0);

      // Flatten the camera
      // @ts-ignore
      camera.fov = 1;
      camera.updateProjectionMatrix();

      controlsRef.current?.update!();

      // Re-enable the controls now that we're finished fiddling with the camera
      controlsRef.current!.enabled = true;
    }
  }, [view, camera]);

  const [waitingForResetComplete, setWaitingForResetComplete] = useState(true);

  /**
   * Reset the camera on sim reset
   * @see resetViewer for resetting the stage dimensions and recoil state
   */
  useEffect(() => {
    if (resetting === true) {
      setWaitingForResetComplete(true);
      return;
    } else if (waitingForResetComplete) {
      setWaitingForResetComplete(false);
    } else {
      return;
    }

    // Disable the controls while we manually fiddle with the camera
    // If we don't, then the camera will update and mess with our changes
    controlsRef.current!.enabled = false;

    const aspect = 1;

    // Set a box using the stage dimensions to position the camera above it
    const { pxMax, pxMin, pyMax, pyMin } = dimensions;
    const box = new THREE.Box3(
      new THREE.Vector3(pxMin, pyMin, 0),
      new THREE.Vector3(pxMax, pyMax, 1),
    );

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const maxSize = Math.max(size.x, size.y, size.z, 40);
    const fitHeightDistance =
      maxSize / (2 * Math.atan((Math.PI * cameraFov) / 360));
    const fitWidthDistance = fitHeightDistance / aspect;
    const distance = 1 * Math.max(fitHeightDistance, fitWidthDistance, 10);

    const direction = (controlsRef.current!.target! as THREE.Vector3)
      .clone()
      .sub(camera.position)
      .normalize()
      .multiplyScalar(distance);

    (controlsRef.current!.target! as THREE.Vector3).copy(center);

    camera.position
      .copy(controlsRef.current!.target! as THREE.Vector3)
      .sub(direction);
    controlsRef.current!.update!();

    // Disable the controls while we manually fiddle with the camera
    // If we don't, then the camera will update and mess with our changes
    controlsRef.current!.enabled = true;
  }, [dimensions, mappedTransitions, resetting]);

  return <OrbitControls ref={controlsRef} />;
};
