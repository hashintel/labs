//! Manage the state of the 3d viewer from one place

import { AtomEffect } from "recoil";

import { AgentTransition, RenderSummary } from "../util/anim";
import { autoAtom, autoSelector, autoreadSelectorFamily } from "./util";
import { getItem, setItem } from "../../../hooks/useLocalStorage";
import { projectChangeObservable } from "../../../features/project/observables";
import { selectProjectPathWithNamespace } from "../../../features/project/selectors";
import { store } from "../../../features/store";

//----------------------- 3D Mesh Data & Transitions ------------------------/
export const MappedTransitions = autoAtom({
  default: {} as RenderSummary,

  // A little faster, and lets us do modifications in place instead of having to reallocate
  // We still make sure to use "setMappedTransitons" when intending to update subscribers
  dangerouslyAllowMutability: true,
});

export const SelectedAgentIds = autoAtom({
  default: {} as Record<string, true>,
});

export const SelectedAgentData = autoreadSelectorFamily({
  get:
    (agentId: string) =>
    ({ get }): AgentTransition | null | undefined => {
      const transitions = get(MappedTransitions);
      return transitions[agentId];
    },

  // Because we're selecting agent data, we *also* need to allow mutability
  dangerouslyAllowMutability: true,
});

export const SelectedMeshes = autoSelector({
  get: ({ get }) => {
    const selectedAgents = get(SelectedAgentIds);
    const mappedTransitions = get(MappedTransitions);

    const meshes: RenderSummary = {};
    for (const id of Object.keys(selectedAgents)) {
      const transition = mappedTransitions[id];
      if (transition) {
        meshes[id] = transition;
      }
    }
    return meshes;
  },
});

// Break the input summary apart into groups based on meshes which get passed on to the individual meshes
export const PositionedMeshes = autoSelector({
  get: ({ get }) => {
    const mappedTransitions = get(MappedTransitions);
    const meshes: Record<string, RenderSummary> = {};
    for (const [id, agent] of Object.entries(mappedTransitions)) {
      if (!meshes.hasOwnProperty(agent.shape)) {
        meshes[agent.shape] = {};
      }
      meshes[agent.shape][id] = agent;
    }
    return meshes;
  },
});
export const ShapedMeshes = autoreadSelectorFamily({
  get:
    (shape: string) =>
    ({ get }) => {
      const meshes = get(PositionedMeshes);
      if (shape === "pickedAgent") {
        const selected = get(SelectedAgentIds);
        const transitions = get(MappedTransitions);
        const output: RenderSummary = {};
        for (const id of Object.keys(selected)) {
          const trans = transitions[id];
          if (trans) {
            output[id] = trans;
          }
        }
        return output;
      } else {
        return meshes[shape] ?? {};
      }
    },
});
export const ShapedMeshesEntries = autoreadSelectorFamily({
  get:
    (shape: string) =>
    ({ get }) => {
      const meshes = get(ShapedMeshes(shape));
      return Object.entries(meshes);
    },
});

type HoveredAgent = string | null;
export const HoveredAgent = autoAtom({
  default: null as HoveredAgent,
});

//----------------------- 3D Viewer Settings ------------------------/

// For each setting, store the lastSet value plus any project-specific value
type ViewerSettingValue = number | string | boolean;
interface ViewerSettingsStorageObject {
  lastSet: ViewerSettingValue;
  [projectPath: string]: ViewerSettingValue;
}

// Persist and retrieve 3D settings state to localStorage,
// for settings configurable in SceneSettings
const localStorageSyncEffect =
  <T extends ViewerSettingValue>(settingName: string) =>
  ({ setSelf, onSet }: Parameters<AtomEffect<T>>[0]) => {
    const storageKey = `sceneSettings.${settingName}`;

    const getProjectPath = () =>
      selectProjectPathWithNamespace(store.getState());

    const loadValueFromLocalStorage = () => {
      const currentProjectPath = getProjectPath();

      // Get the last used value for this setting, if any
      const savedSettings = getItem<ViewerSettingsStorageObject>(storageKey);
      let savedSetting = savedSettings?.lastSet;

      // If we have a project-specific value for this setting, prefer it
      if (currentProjectPath && savedSettings?.[currentProjectPath]) {
        savedSetting = savedSettings[currentProjectPath];
      }

      if (savedSetting != null) {
        setSelf(savedSetting as T);
      }
    };

    projectChangeObservable(store).subscribe(() => {
      loadValueFromLocalStorage();
    });

    // Called when the atom is updated from elsewhere (e.g. on user input)
    onSet((newValue) => {
      const currentProjectPath = getProjectPath();

      // Store the value as last set and (if project scoped) project-specific
      const savedSettings: ViewerSettingsStorageObject = {
        ...(getItem(storageKey) ?? {}),
        lastSet: newValue as ViewerSettingValue,
      };
      if (currentProjectPath) {
        savedSettings[currentProjectPath] = newValue as ViewerSettingValue;
      }

      setItem(storageKey, savedSettings);
    });
  };

const settingAtom = <T extends ViewerSettingValue>(
  key: string,
  defaultValue: T,
) =>
  autoAtom<T>({
    default: defaultValue,
    effects_UNSTABLE: [localStorageSyncEffect<T>(key)],
  });

// The settings configurable in SceneSettings
export const SceneView = settingAtom<"3d" | "2d">("view", "3d");
export const CameraFov = settingAtom<number>("fov", 30);
export const StageColor = settingAtom<string>("stageColor", "#111216");
export const GridColor = settingAtom<string>("gridColor", "#444444");
export const GridEnabled = settingAtom<boolean>("gridEnabled", true);
export const FloorEnabled = settingAtom<boolean>("floorEnabled", true);
export const AxesEnabled = settingAtom<boolean>("axesEnabled", true);
export const EdgesEnabled = settingAtom<boolean>("edgesEnabled", true);
export const UpdatesEnabled = settingAtom<boolean>("updatesEnabled", true);
export const LightEnabled = settingAtom<boolean>("lightEnabled", true);
export const StatsEnabled = settingAtom<boolean>("statsEnabled", false);
export const SampleLevel = settingAtom<number>("sampleLevel", 3);

//----------------------- Stage Dimensions ------------------------/
export const dimensionDefaults = {
  pxMax: 10,
  pxMin: -10,
  pyMax: 10,
  pyMin: -10,
};
export const StageDimensions = autoAtom({
  default: dimensionDefaults,
});
