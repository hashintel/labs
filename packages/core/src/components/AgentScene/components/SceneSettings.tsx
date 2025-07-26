import React, { FC } from "react";
import { useRecoilState } from "recoil";

import {
  AxesEnabled,
  EdgesEnabled,
  FloorEnabled,
  GridColor,
  GridEnabled,
  SampleLevel,
  SceneView,
  StageColor,
  StatsEnabled,
  UpdatesEnabled,
} from "../state/SceneState";
import { CheckboxInput } from "../../Inputs/Checkbox/CheckboxInput";
import { IconSettings } from "../../Icon/Settings";
import { SimpleTooltip } from "../../SimpleTooltip";
import { TextOrNumberInput } from "../../Inputs";

export const SceneSettings: FC = () => {
  const [floorEnabled, setFloorEnabled] = useRecoilState(FloorEnabled);
  const toggleStage = () => setFloorEnabled(!floorEnabled);

  const [gridEnabled, setGridEnabled] = useRecoilState(GridEnabled);
  const toggleGrid = () => setGridEnabled(!gridEnabled);

  const [axesEnabled, setAxesEnabled] = useRecoilState(AxesEnabled);
  const toggleAxes = () => setAxesEnabled(!axesEnabled);

  const [statsEnabled, setStatsEnabled] = useRecoilState(StatsEnabled);
  const toggleStats = () => setStatsEnabled(!statsEnabled);

  const [edgesEnabled, setEdgesEnabled] = useRecoilState(EdgesEnabled);
  const toggleEdges = () => setEdgesEnabled(!edgesEnabled);

  const [updatesEnabled, setUpdatesEnabled] = useRecoilState(UpdatesEnabled);
  const toggleUpdates = () => setUpdatesEnabled(!updatesEnabled);

  const [view, setView] = useRecoilState(SceneView);
  const toggleView = () => setView(view === "2d" ? "3d" : "2d");

  const [stageColor, setStageColor] = useRecoilState(StageColor);
  const [gridColor, setGridColor] = useRecoilState(GridColor);

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
  const [sampleLevel, setSampleLevel] = useRecoilState(SampleLevel);
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
