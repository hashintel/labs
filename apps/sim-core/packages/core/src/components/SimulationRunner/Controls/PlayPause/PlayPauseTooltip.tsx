import React, { FC } from "react";

import { DEFAULT_STEPS_PER_SECOND } from "../../../../features/simulator/simulate/util";
import { PlayPauseTooltipModeSwitcher } from "./PlayPauseTooltipModeSwitcher";
import { PlayPauseTooltipSpeedButton } from "./PlayPauseTooltipSpeedButton";
import { SimpleTooltip } from "../../../SimpleTooltip";
import { SimpleTooltipProps } from "../../../SimpleTooltip/SimpleTooltip";
import {
  selectCanCurrentSimCompute,
  selectCurrentSimStepRetention,
  selectPresenting,
  selectRunning,
} from "../../../../features/simulator/simulate/selectors";
import { useSimulatorSelector } from "../../../../features/simulator/context";

import "./PlayPauseTooltip.scss";

const presentSpeeds = [
  ...[
    ...new Set([0, 1, 2, 3, 4, 5, 10, 30, 90, 120, DEFAULT_STEPS_PER_SECOND]),
  ].sort((a, b) => a - b),
  "live" as const,
];

const presentingDisabledForSpeed = (speed: number | "live") =>
  speed === 0 || speed === "live";

export const PlayPauseTooltip: FC<{
  onOpenChange: SimpleTooltipProps["onOpenChange"];
}> = ({ onOpenChange }) => {
  const canCompute = useSimulatorSelector(selectCanCurrentSimCompute);
  const stepsToRetain = useSimulatorSelector(selectCurrentSimStepRetention);
  const running = useSimulatorSelector(selectRunning);
  const presenting = useSimulatorSelector(selectPresenting);

  return (
    <SimpleTooltip
      position="above"
      className="SimulationRunnerTooltip--simulate PlayPauseTooltip"
      interactive
      onOpenChange={onOpenChange}
    >
      <h4 className="PlayPauseTooltip__Header">
        Playback speed <small>Steps/Second</small>
      </h4>
      <div className="PlayPauseTooltip__PlaybackSpeeds">
        {presentSpeeds.map((speed) => (
          <PlayPauseTooltipSpeedButton
            speed={speed}
            key={speed}
            disabled={
              (!canCompute && presentingDisabledForSpeed(speed)) ||
              (canCompute && stepsToRetain.retentionPolicy === "some")
            }
            activeDisabled={speed === "live" ? running : presenting}
          />
        ))}
      </div>
      <hr />
      <PlayPauseTooltipModeSwitcher />
    </SimpleTooltip>
  );
};
