import React, { useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { Json, SerializableAgentState } from "@hashintel/engine-web";
import { Stats } from "@react-three/drei";

import { useSceneContext } from "./state/SceneContext";
import { AgentRenderer } from "./components/AgentRenderer";
import { HoveredAgent } from "./components/HoveredAgent";
import { NetworkEdges } from "./components/NetworkEdges";
import { SceneSettings } from "./components/SceneSettings";
import { SimulationViewerLazyTab } from "../SimulationViewer/LazyTab/SimulationViewerLazyTab";
import { ViewerControls, orthoCamera } from "./components/Controls";
import { ViewerStage } from "./components/Stage";
import { useViewer } from "../../features/viewer/ViewerContext";

import "./AgentScene.css";

// Future functionality
// - https://threejs.org/examples/#webgl_trails
// - https://github.com/mrdoob/three.js/blob/master/examples/webgl_buffergeometry_drawrange.html

export type SimulationStepProps = {
  simulationRunId: string | undefined;
  properties: Json;
  simulationStep: SerializableAgentState[] | null;
  simulating: boolean;
  visible: boolean;
  resetting: boolean;
  errored: boolean;
};

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export const AgentScene = ({
  simulationStep,
  resetting,
  errored,
  simulationRunId,
}: SimulationStepProps) => {
  const {
    mappedTransitions,
    setMappedTransitions,
    statsEnabled: showStats,
    updatesEnabled,
    edgesEnabled,
    sampleLevel,
    updateTransitionMap,
    resetViewer,
  } = useSceneContext();

  const statsContainerRef = useRef(null);

  const { embedded } = useViewer();

  /**
   * Updating the stage is an async process, but it can only be done on at a
   * time. This ref holds a promise chain which you can attach to and reassign
   * whenever you want to schedule an update to the stage, and it'll wait until
   * the last update was done.
   */
  const stageUpdateChainRef = useRef<Promise<unknown>>(null as any);
  if (!stageUpdateChainRef.current) {
    stageUpdateChainRef.current = Promise.resolve();
  }

  useEffect(() => {
    if (resetting) {
      stageUpdateChainRef.current = stageUpdateChainRef.current
        .catch((err) => {
          console.error(err);
        })
        .then(() => resetViewer());
    }
  }, [resetting, setMappedTransitions, resetViewer]);

  /*
  # Update the transition map every time the simulaton step changes
  This essentially memoizes the simulation state while peforming transitions in-place
  */
  useEffect(() => {
    /**
     * We can't run this while resetting, because simulationStep may not yet
     * have properly initialised – which would result in incorrect stage
     * dimensions from the start, which updateTransitionMap will then never
     * correct. I'm not sure I fully understand what's going on here, so we
     * should come back to this later to clean up properly
     */
    if (!resetting) {
      // Weird, but we need to pass in the mutable version of the transitions
      // Getting the loadable is fine (and should be moved to), but for now
      // we can just mutate in place
      stageUpdateChainRef.current = stageUpdateChainRef.current
        .catch((err) => {
          console.error(err);
        })
        .then(() =>
          updateTransitionMap(mappedTransitions, simulationStep ?? [])
        );
    }
  }, [resetting, simulationStep, updateTransitionMap]);

  if (simulationRunId && !simulationStep && !errored) {
    return <SimulationViewerLazyTab />;
  }

  return (
    <div className="AgentScene">
      <div
        className="StatsContainer"
        hidden={!showStats}
        ref={statsContainerRef}
      >
        <Stats className={"StatsMonitor"} parent={statsContainerRef} />
      </div>

      <Canvas
        /**
         * This is a fix for Safari resizing – height 100% doesn't work inside
         * a flex container.
         *
         * @see https://github.com/philipwalton/flexbugs/issues/197
         */
        style={{ position: "absolute" }}
        gl={{
          // We use a fairly "flat" camera with no apparent depth (almost like a CAD program).
          // Cameras are typically perspective and render different depths with propery aliasing
          // However, with a flat camera, the renderer fails to compensate with all the various
          // deviation in depths. As such, we nee to use a log-based depth buffer.
          logarithmicDepthBuffer: true,

          antialias: true,
          powerPreference: getPowerPreference(sampleLevel),
          precision: getSampleLevel(sampleLevel),
        }}
        camera={orthoCamera}
        /**
         * Keeping react-three-fiber's color management on leads to them looking 'washed out' compared to the previous look
         */
        colorManagement={false}
        onCreated={({ gl }) => gl.setClearColor("#0e0d15")}
        invalidateFrameloop={!updatesEnabled}
      >
          <fog args={["white", 50000, 3000000]} attach="fog" />
          <ViewerControls
            mappedTransitions={mappedTransitions}
            resetting={resetting}
          />
          {edgesEnabled && (
            <NetworkEdges mappedTransitions={mappedTransitions} />
          )}
          <ambientLight intensity={0.65} />
          <pointLight position={[0, 0, 30]} up={[0, 0, 1]} intensity={0.8} />
          <ViewerStage />
          <AgentRenderer mappedTransitions={mappedTransitions} />
          <HoveredAgent transitions={mappedTransitions} />
      </Canvas>
      {!embedded && <SceneSettings />}
    </div>
  );
};

/**
 * Converts a 1-3 slider level to the precision required by the gl renderer
 */
const getSampleLevel = (sampleLevel: number) => {
  switch (sampleLevel) {
    case 1:
      return "lowp";
    case 2:
      return "mediump";
    case 3:
    default:
      return "highp";
  }
};

const getPowerPreference = (sampleLevel: number) => {
  switch (sampleLevel) {
    case 1:
      return "low-power";
    case 2:
    case 3:
    default:
      return "high-performance";
  }
};
