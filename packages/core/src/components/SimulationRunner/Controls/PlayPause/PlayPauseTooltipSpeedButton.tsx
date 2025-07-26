import React, { FC } from "react";
import classNames from "classnames";

import {
  selectCanCurrentSimCompute,
  selectCanPlayPause,
  selectCanPresent,
  selectPresentingSpeed,
} from "../../../../features/simulator/simulate/selectors";
import { setViewerSpeed } from "../../../../features/simulator/simulate/thunks";
import {
  useSimulatorDispatch,
  useSimulatorSelector,
} from "../../../../features/simulator/context";

export const PlayPauseTooltipSpeedButton: FC<{
  speed: number | "live";
  full?: boolean;
  disabled?: boolean;
  activeDisabled?: boolean;
}> = ({ speed, full = false, disabled, activeDisabled }) => {
  const presentingSpeed = useSimulatorSelector(selectPresentingSpeed);
  const active = presentingSpeed === speed;
  const simulatorDispatch = useSimulatorDispatch();
  const canCompute = useSimulatorSelector(selectCanCurrentSimCompute);
  const canPlayPause = useSimulatorSelector(selectCanPlayPause);
  const canPresent = useSimulatorSelector(selectCanPresent);

  return (
    <button
      className={classNames("PlayPauseTooltip__PlaybackSpeeds__Button", {
        "PlayPauseTooltip__PlaybackSpeeds__Button--active": active,
        "PlayPauseTooltip__PlaybackSpeeds__Button--full": full,
      })}
      disabled={
        disabled ||
        (active && activeDisabled) ||
        (canCompute ? !canPlayPause : !canPresent)
      }
      key={speed}
      onClick={(evt) => {
        evt.preventDefault();
        simulatorDispatch(setViewerSpeed(speed));
      }}
    >
      {speed === "live" ? "Max" : speed}
    </button>
  );
};
