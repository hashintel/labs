import React, { FC } from "react";
import classNames from "classnames";

import { RadioInput, RadioInputProps } from "../../../Inputs/Radio/RadioInput";
import { RoundedTextInput } from "../../../Inputs";
import { SimulationData } from "../../../../features/simulator/simulate/types";
import {
  selectCurrentRunnerHasSteps,
  selectCurrentSimMode,
  selectCurrentSimStepRetention,
  selectPresentingSpeed,
} from "../../../../features/simulator/simulate/selectors";
import {
  setSimulationStepRetention,
  toggleCurrentSimulationMode,
} from "../../../../features/simulator/simulate/slice";
import {
  useSimulatorDispatch,
  useSimulatorSelector,
} from "../../../../features/simulator/context";

import "./PlayPauseTooltipModeSwitcher.scss";

const PlayPauseTooltipModeLabel: FC<
  Omit<RadioInputProps, "tick" | "name"> & {
    name: "simulationMode" | "stepsToRetain";
  }
> = ({ disabled, children, name, ...props }) => (
  <label
    className={classNames("PlayPauseTooltipModeLabel", {
      "PlayPauseTooltipModeLabel--disabled": disabled,
    })}
  >
    <RadioInput tick name={name} {...props} disabled={disabled} />
    {children}
  </label>
);

export const PlayPauseTooltipModeSwitcher: FC = () => {
  const speed = useSimulatorSelector(selectPresentingSpeed);
  const mode = useSimulatorSelector(selectCurrentSimMode);
  const { retentionPolicy, stepsToRetain } = useSimulatorSelector(
    selectCurrentSimStepRetention,
  );
  const hasSteps = useSimulatorSelector(selectCurrentRunnerHasSteps);
  const dispatch = useSimulatorDispatch();

  const toggleSimulationMode = () => {
    dispatch(toggleCurrentSimulationMode());
  };

  const setStepRetention = (payload: SimulationData["stepRetention"]) => {
    dispatch(setSimulationStepRetention(payload));
  };

  const playbackMode = mode === "historic" || mode === "playback";

  const selectiveRetentionActive = retentionPolicy === "some";

  return (
    <>
      <h4 className="PlayPauseTooltipModeSwitcherHeader">Simulation Mode</h4>
      <ul className="PlayPauseTooltipModeSwitcher">
        <li>
          <PlayPauseTooltipModeLabel
            name="simulationMode"
            value="compute"
            disabled={mode === "historic" || selectiveRetentionActive}
            checked={mode === "computeAndPlayback"}
            onChange={toggleSimulationMode}
          >
            {speed === 0 ? <>Compute only</> : <>Compute and playback</>}
          </PlayPauseTooltipModeLabel>
        </li>
        <li>
          <PlayPauseTooltipModeLabel
            name="simulationMode"
            value="playback"
            checked={playbackMode}
            onChange={toggleSimulationMode}
            disabled={(!playbackMode && !hasSteps) || selectiveRetentionActive}
          >
            Playback only
          </PlayPauseTooltipModeLabel>
        </li>
      </ul>
      <h4 className="PlayPauseTooltipModeSwitcherHeader">Steps to retain</h4>
      <ul className="PlayPauseTooltipModeSwitcher">
        <li>
          <PlayPauseTooltipModeLabel
            name="stepsToRetain"
            value={"all"}
            checked={!selectiveRetentionActive}
            onChange={() =>
              setStepRetention({ retentionPolicy: "all", stepsToRetain })
            }
            disabled={
              mode === "historic" || (selectiveRetentionActive && hasSteps)
            }
          >
            All
          </PlayPauseTooltipModeLabel>
        </li>
        <li className="PlayPauseTooltipModeSwitcher__StepRetentionSelector">
          <PlayPauseTooltipModeLabel
            name="stepsToRetain"
            value={"some"}
            checked={selectiveRetentionActive}
            onChange={() =>
              setStepRetention({ retentionPolicy: "some", stepsToRetain })
            }
            disabled={mode === "historic" || hasSteps}
          >
            Only keep
            <RoundedTextInput
              disabled={mode === "historic" || hasSteps}
              min={1}
              onChange={({ target }) => {
                setStepRetention({
                  retentionPolicy,
                  stepsToRetain: parseInt(target.value),
                });
              }}
              type="number"
              value={stepsToRetain}
            />
            steps
          </PlayPauseTooltipModeLabel>
        </li>
      </ul>
    </>
  );
};
