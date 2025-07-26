import React, { FC } from "react";

import { IconRestart } from "../../Icon";
import { SimpleTooltip } from "../../SimpleTooltip";
import { pauseAndNew } from "../../../features/simulator/simulate/thunks";
import {
  selectResetting,
  selectRunning,
} from "../../../features/simulator/simulate/selectors";
import {
  useSimulatorDispatch,
  useSimulatorSelector,
} from "../../../features/simulator/context";

export const Reset: FC = () => {
  const running = useSimulatorSelector(selectRunning);
  const simulatorDispatch = useSimulatorDispatch();
  const resetting = useSimulatorSelector(selectResetting);

  return (
    <div className="reset simulation-control">
      <button
        onClick={() => {
          simulatorDispatch(pauseAndNew());
        }}
        disabled={resetting}
      >
        <SimpleTooltip
          position="above"
          align="left"
          flatLeft
          className="SimulationRunnerTooltip--reset"
        >
          <h4>Reset simulation</h4>
          <p>
            End {running ? <>active run</> : <>last active run</>} and clear
            viewer
          </p>
        </SimpleTooltip>
        <IconRestart />
      </button>
    </div>
  );
};
