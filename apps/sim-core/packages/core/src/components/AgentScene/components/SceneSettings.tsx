import React, { FC } from "react";

import { useSceneContext } from "../state/SceneContext";
import { CheckboxInput } from "../../Inputs/Checkbox/CheckboxInput";
import { IconSettings } from "../../Icon/Settings";
import { SimpleTooltip } from "../../SimpleTooltip";
import { TextOrNumberInput } from "../../Inputs";

export const SceneSettings: FC = () => {
  const {
    floorEnabled,
    setFloorEnabled,
    gridEnabled,
    setGridEnabled,
    axesEnabled,
    setAxesEnabled,
    statsEnabled,
    setStatsEnabled,
    edgesEnabled,
    setEdgesEnabled,
    updatesEnabled,
    setUpdatesEnabled,
    sceneView: view,
    setSceneView: setView,
    stageColor,
    setStageColor,
    gridColor,
    setGridColor,
  } = useSceneContext();

  const toggleStage = () => setFloorEnabled(!floorEnabled);
  const toggleGrid = () => setGridEnabled(!gridEnabled);
  const toggleAxes = () => setAxesEnabled(!axesEnabled);
  const toggleStats = () => setStatsEnabled(!statsEnabled);
  const toggleEdges = () => setEdgesEnabled(!edgesEnabled);
  const toggleUpdates = () => setUpdatesEnabled(!updatesEnabled);
  const toggleView = () => setView(view === "2d" ? "3d" : "2d");

  return (
    <div className="SceneSettings">
      <IconSettings size={18} />
      <SimpleTooltip
        align="right"
        allRoundedBorders
        className="SceneSettingsTooltip"
        interactive
        persistent
        position="below"
      >
        <Toggler
          checked={view === "3d"}
          toggleFn={toggleView}
          label={`View mode: ${view.toUpperCase()}`}
        />
        <Toggler
          toggleFn={toggleGrid}
          checked={gridEnabled}
          label="Show grid"
        />
        <Toggler
          toggleFn={toggleStage}
          checked={floorEnabled}
          label="Show stage"
        />
        <Toggler
          toggleFn={toggleAxes}
          checked={axesEnabled}
          label="Show axes helper"
        />
        <Toggler
          toggleFn={toggleEdges}
          checked={edgesEnabled}
          label="Show network edges"
        />
        <Toggler
          toggleFn={toggleUpdates}
          checked={updatesEnabled}
          label="Enable scene updates"
        />
        <Toggler
          toggleFn={toggleStats}
          checked={statsEnabled}
          label="Show stats"
        />
        <ColorPicker
          label="Stage color"
          onChange={setStageColor}
          value={stageColor}
        />
        <ColorPicker
          label="Grid color"
          onChange={setGridColor}
          value={gridColor}
        />
        <SampleLevelSlider />
      </SimpleTooltip>
    </div>
  );
};

const ColorPicker: FC<{
  label: string;
  onChange: (value: string) => void;
  value: string;
}> = ({ label, onChange, value }) => (
  <div className="SceneSettings__SettingRow SceneSettings__ColorPicker">
    <input
      id={label}
      onChange={(evt) => onChange(evt.target.value)}
      type="color"
      value={value}
    />
    <label htmlFor={label}>{label}</label>
  </div>
);

const Toggler: FC<{
  toggleFn: () => void;
  checked: boolean;
  label: string;
}> = ({ toggleFn, checked, label }) => {
  return (
    <div className="SceneSettings__SettingRow">
      <CheckboxInput checked={checked} id={label} onChange={toggleFn} />
      <label htmlFor={label}>{label}</label>
    </div>
  );
};

const SampleLevelSlider: FC = () => {
  const { sampleLevel, setSampleLevel } = useSceneContext();
  return (
    <div className="SceneSettings__SettingRow">
      <TextOrNumberInput
        min={1}
        max={3}
        onChange={(val) => setSampleLevel(val as number)}
        step={1}
        type="number"
        value={sampleLevel}
      />
      <label>Sample level</label>
    </div>
  );
};
