import React, { FC } from "react";

import { SimpleTooltip } from "../../SimpleTooltip";
import {
  selectCanPlayPause,
  selectRunning,
} from "../../../features/simulator/simulate/selectors";
import { stepSimulator } from "../../../features/simulator/simulate/thunks";
import {
  useSimulatorDispatch,
  useSimulatorSelector,
} from "../../../features/simulator/context";

export const StepButton: FC = () => {
  const canPlayPause = useSimulatorSelector(selectCanPlayPause);
  const running = useSimulatorSelector(selectRunning);

  const simulatorDispatch = useSimulatorDispatch();

  return (
    <div className="step simulation-control">
      <button
        onClick={() => {
          simulatorDispatch(stepSimulator());
        }}
        disabled={!canPlayPause || running}
      >
        <SimpleTooltip
          position="above"
          className="SimulationRunnerTooltip--step"
        >
          <h4>Step simulation</h4>
          <p>Generate one additional step in your simulation</p>
        </SimpleTooltip>
        +1
      </button>
    </div>
  );
};
