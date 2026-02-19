import React, {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { AgentState, Vec3 } from "@hashintel/engine-web";
import * as THREE from "three";

import { AgentTransition, RenderSummary } from "../util/anim";
import { getItem, setItem } from "../../../hooks/useLocalStorage/utils";
import { useFiles } from "../../../features/files/FilesContext";
import { useProject } from "../../../features/project/ProjectContext";

const tempColor = new THREE.Color();

// ---------------------- Settings localStorage helpers ----------------------

type ViewerSettingValue = number | string | boolean;
type ViewerSettingsStorageObject = {
  lastSet: ViewerSettingValue;
  [projectPath: string]: ViewerSettingValue;
};

function loadSetting<T extends ViewerSettingValue>(
  key: string,
  defaultValue: T,
  projectPath: string | undefined,
): T {
  const storageKey = `sceneSettings.${key}`;
  const saved = getItem<ViewerSettingsStorageObject>(storageKey);
  if (projectPath && saved?.[projectPath] != null) return saved[projectPath] as T;
  if (saved?.lastSet != null) return saved.lastSet as T;
  return defaultValue;
}

function saveSetting(key: string, value: ViewerSettingValue, projectPath: string | undefined) {
  const storageKey = `sceneSettings.${key}`;
  const saved: ViewerSettingsStorageObject = {
    ...(getItem(storageKey) ?? {}),
    lastSet: value,
  };
  if (projectPath) saved[projectPath] = value;
  setItem(storageKey, saved);
}

function usePersistedSetting<T extends ViewerSettingValue>(
  key: string,
  defaultValue: T,
  projectPath: string | undefined,
): [T, (v: T) => void] {
  const [value, setRaw] = useState<T>(() => loadSetting(key, defaultValue, projectPath));
  const set = useCallback(
    (v: T) => {
      setRaw(v);
      saveSetting(key, v, projectPath);
    },
    [key, projectPath],
  );
  return [value, set];
}

// ---------------------- Dimension defaults ----------------------

export const dimensionDefaults = {
  pxMax: 10,
  pxMin: -10,
  pyMax: 10,
  pyMin: -10,
};

export type StageDimensionsType = typeof dimensionDefaults;

// ---------------------- Context value type ----------------------

export interface SceneContextValue {
  // Core data
  mappedTransitions: RenderSummary;
  setMappedTransitions: React.Dispatch<React.SetStateAction<RenderSummary>>;
  stageDimensions: StageDimensionsType;
  setStageDimensions: React.Dispatch<React.SetStateAction<StageDimensionsType>>;
  selectedAgentIds: Record<string, true>;
  setSelectedAgentIds: React.Dispatch<React.SetStateAction<Record<string, true>>>;
  hoveredAgent: string | null;
  setHoveredAgent: React.Dispatch<React.SetStateAction<string | null>>;

  // Derived data
  positionedMeshes: Record<string, RenderSummary>;
  getShapedMeshesEntries: (shape: string) => [string, AgentTransition][];
  getSelectedAgentData: (id: string) => AgentTransition | undefined;

  // Settings
  sceneView: "3d" | "2d";
  setSceneView: (v: "3d" | "2d") => void;
  cameraFov: number;
  setCameraFov: (v: number) => void;
  stageColor: string;
  setStageColor: (v: string) => void;
  gridColor: string;
  setGridColor: (v: string) => void;
  gridEnabled: boolean;
  setGridEnabled: (v: boolean) => void;
  floorEnabled: boolean;
  setFloorEnabled: (v: boolean) => void;
  axesEnabled: boolean;
  setAxesEnabled: (v: boolean) => void;
  edgesEnabled: boolean;
  setEdgesEnabled: (v: boolean) => void;
  updatesEnabled: boolean;
  setUpdatesEnabled: (v: boolean) => void;
  lightEnabled: boolean;
  setLightEnabled: (v: boolean) => void;
  statsEnabled: boolean;
  setStatsEnabled: (v: boolean) => void;
  sampleLevel: number;
  setSampleLevel: (v: number) => void;

  // Actions
  updateTransitionMap: (
    oldSummary: RenderSummary,
    states: AgentState[],
  ) => void;
  resetViewer: () => void;
}

const SceneContext = createContext<SceneContextValue | null>(null);

export const useSceneContext = () => {
  const ctx = useContext(SceneContext);
  if (!ctx) throw new Error("useSceneContext must be inside SceneProvider");
  return ctx;
};

// ---------------------- Provider ----------------------

export const SceneProvider: FC<PropsWithChildren> = ({ children }) => {
  const { currentProject } = useProject();
  const { globalsSrc } = useFiles();
  const projectPath = currentProject?.pathWithNamespace;

  // Core state
  const [mappedTransitions, setMappedTransitions] = useState<RenderSummary>({});
  const [stageDimensions, setStageDimensions] =
    useState<StageDimensionsType>(dimensionDefaults);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Record<string, true>>(
    {},
  );
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);

  // Settings (persisted to localStorage)
  const [sceneView, setSceneView] = usePersistedSetting<"3d" | "2d">("view", "3d", projectPath);
  const [cameraFov, setCameraFov] = usePersistedSetting<number>("fov", 30, projectPath);
  const [stageColor, setStageColor] = usePersistedSetting<string>("stageColor", "#111216", projectPath);
  const [gridColor, setGridColor] = usePersistedSetting<string>("gridColor", "#444444", projectPath);
  const [gridEnabled, setGridEnabled] = usePersistedSetting<boolean>("gridEnabled", true, projectPath);
  const [floorEnabled, setFloorEnabled] = usePersistedSetting<boolean>("floorEnabled", true, projectPath);
  const [axesEnabled, setAxesEnabled] = usePersistedSetting<boolean>("axesEnabled", true, projectPath);
  const [edgesEnabled, setEdgesEnabled] = usePersistedSetting<boolean>("edgesEnabled", true, projectPath);
  const [updatesEnabled, setUpdatesEnabled] = usePersistedSetting<boolean>("updatesEnabled", true, projectPath);
  const [lightEnabled, setLightEnabled] = usePersistedSetting<boolean>("lightEnabled", true, projectPath);
  const [statsEnabled, setStatsEnabled] = usePersistedSetting<boolean>("statsEnabled", false, projectPath);
  const [sampleLevel, setSampleLevel] = usePersistedSetting<number>("sampleLevel", 3, projectPath);

  // Derived: group transitions by mesh type
  const positionedMeshes = useMemo(() => {
    const meshes: Record<string, RenderSummary> = {};
    for (const [id, agent] of Object.entries(mappedTransitions)) {
      if (!meshes[agent.shape]) meshes[agent.shape] = {};
      meshes[agent.shape][id] = agent;
    }
    return meshes;
  }, [mappedTransitions]);

  const getShapedMeshesEntries = useCallback(
    (shape: string): [string, AgentTransition][] => {
      if (shape === "pickedAgent") {
        const output: RenderSummary = {};
        for (const id of Object.keys(selectedAgentIds)) {
          const trans = mappedTransitions[id];
          if (trans) output[id] = trans;
        }
        return Object.entries(output);
      }
      return Object.entries(positionedMeshes[shape] ?? {});
    },
    [positionedMeshes, selectedAgentIds, mappedTransitions],
  );

  const getSelectedAgentData = useCallback(
    (id: string): AgentTransition | undefined => mappedTransitions[id],
    [mappedTransitions],
  );

  // Action: update transition map from new simulation step
  const updateTransitionMap = useCallback(
    (oldSummary: RenderSummary, states: AgentState[]) => {
      const removals = new Set(Object.keys(oldSummary));
      const newSummary = { ...oldSummary };

      for (const agent of states) {
        const agentId = agent.agent_id ?? "AGENT_ID_NOT_FOUND";
        if (!agent.position) continue;

        const oldAgent = newSummary[agentId] as AgentTransition | undefined;
        const [posX, posY, posZ] = [...(agent.position ?? [1, 1, 1])];
        const newPosition: Vec3 = [posX, posY ?? 0, posZ ?? 0];

        const scalex = agent.scale ? agent.scale[0] : 1;
        const scaley = agent.scale ? agent.scale[1] : 1;
        const scalez = agent.height ?? (agent.scale ? agent.scale[2] : 1);
        const newScale: Vec3 = [scalex, scaley, scalez];
        const useHeight = agent.scale === undefined || agent.height !== undefined;

        const [newDirX, newDirY, newDirZ] = [
          ...((Array.isArray(agent.direction) ? agent.direction : null) ??
            (Array.isArray(agent.velocity) ? agent.velocity : null) ?? [0, 0, 0]),
        ];
        const newDirection: Vec3 = [newDirX ?? 0, newDirY ?? 0, newDirZ ?? 0];
        if (newDirection[0] === 0 && newDirection[1] === 0 && newDirection[2] === 0) {
          const oldDir = oldAgent?.direction.to ?? oldAgent?.direction.current;
          if (oldDir) {
            newDirection[0] = oldDir[0];
            newDirection[1] = oldDir[1];
            newDirection[2] = oldDir[2];
          }
        }

        tempColor.set(agent.color ?? "green");
        const newColor: Vec3 = [tempColor.r, tempColor.g, tempColor.b];
        if (agent.rgb && !agent.color) {
          newColor[0] = agent.rgb[0] / 255;
          newColor[1] = agent.rgb[1] / 255;
          newColor[2] = agent.rgb[2] / 255;
        }

        let shape = agent.shape ?? oldAgent?.shape;
        if (!shape) {
          shape = agent.direction || agent.velocity ? "cone" : "box";
        }

        if (oldAgent) {
          newSummary[agentId] = {
            ...oldAgent,
            shape,
            original: agent,
            hidden: agent.hidden ?? false,
            color: { current: [...oldAgent.color.to], to: newColor },
            direction: { current: oldAgent.direction.to, to: newDirection },
            scale: { current: oldAgent.scale.to, to: newScale },
            position: { current: oldAgent.position.to, to: newPosition },
            network_neighbor_ids: agent.network_neighbor_ids,
            network_neighbor_in_ids: agent.network_neighbor_in_ids,
            network_neighbor_out_ids: agent.network_neighbor_out_ids,
          };
        } else {
          newSummary[agentId] = {
            color: { current: newColor, to: newColor },
            direction: { current: newDirection, to: newDirection },
            position: { current: newPosition, to: newPosition },
            scale: { current: [0, 0, 0], to: newScale },
            network_neighbor_ids: agent.network_neighbor_ids,
            network_neighbor_in_ids: agent.network_neighbor_in_ids,
            network_neighbor_out_ids: agent.network_neighbor_out_ids,
            useHeight,
            remove: false,
            shape,
            original: agent,
            hidden: agent.hidden ?? false,
          };
        }
        removals.delete(agentId);
      }

      for (const removal of removals.values()) {
        const oldAgent = newSummary[removal];
        if (oldAgent) {
          if (oldAgent.remove) {
            delete newSummary[removal];
          } else {
            newSummary[removal] = {
              ...oldAgent,
              remove: true,
              scale: { ...oldAgent.scale, to: [0, 0, 0] },
            };
          }
        }
      }

      setMappedTransitions(newSummary);

      setStageDimensions((dims) => {
        let { pxMax, pxMin, pyMax, pyMin } = dims;
        for (const agent of Object.values(newSummary)) {
          pxMax = Math.max(agent.position.to[0], pxMax);
          pxMin = Math.min(agent.position.to[0], pxMin);
          pyMax = Math.max(agent.position.to[1], pyMax);
          pyMin = Math.min(agent.position.to[1], pyMin);
        }
        return { pxMax, pxMin, pyMax, pyMin };
      });
    },
    [],
  );

  // Action: reset viewer to initial state
  const resetViewer = useCallback(() => {
    let { pxMin, pxMax, pyMin, pyMax } = dimensionDefaults;
    if (globalsSrc) {
      try {
        const { topology } = JSON.parse(globalsSrc);
        if (topology) {
          pxMin = topology.x_bounds?.[0] ?? pxMin;
          pxMax = topology.x_bounds?.[1] ?? pxMax;
          pyMin = topology.y_bounds?.[0] ?? pyMin;
          pyMax = topology.y_bounds?.[1] ?? pyMax;
        }
      } catch {
        // globals.json is not valid JSON
      }
    }
    setStageDimensions({ pxMin, pxMax, pyMin, pyMax });
    setSelectedAgentIds({});
    setHoveredAgent(null);
  }, [globalsSrc]);

  const value = useMemo<SceneContextValue>(
    () => ({
      mappedTransitions,
      setMappedTransitions,
      stageDimensions,
      setStageDimensions,
      selectedAgentIds,
      setSelectedAgentIds,
      hoveredAgent,
      setHoveredAgent,
      positionedMeshes,
      getShapedMeshesEntries,
      getSelectedAgentData,
      sceneView, setSceneView,
      cameraFov, setCameraFov,
      stageColor, setStageColor,
      gridColor, setGridColor,
      gridEnabled, setGridEnabled,
      floorEnabled, setFloorEnabled,
      axesEnabled, setAxesEnabled,
      edgesEnabled, setEdgesEnabled,
      updatesEnabled, setUpdatesEnabled,
      lightEnabled, setLightEnabled,
      statsEnabled, setStatsEnabled,
      sampleLevel, setSampleLevel,
      updateTransitionMap,
      resetViewer,
    }),
    [
      mappedTransitions, stageDimensions, selectedAgentIds, hoveredAgent,
      positionedMeshes, getShapedMeshesEntries, getSelectedAgentData,
      sceneView, cameraFov, stageColor, gridColor,
      gridEnabled, floorEnabled, axesEnabled, edgesEnabled,
      updatesEnabled, lightEnabled, statsEnabled, sampleLevel,
      updateTransitionMap, resetViewer,
      setSceneView, setCameraFov, setStageColor, setGridColor,
      setGridEnabled, setFloorEnabled, setAxesEnabled, setEdgesEnabled,
      setUpdatesEnabled, setLightEnabled, setStatsEnabled, setSampleLevel,
    ],
  );

  return (
    <SceneContext.Provider value={value}>{children}</SceneContext.Provider>
  );
};
