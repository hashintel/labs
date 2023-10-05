import React, { FC } from "react";

import { IconPause, IconRunFast } from "../../../Icon";
import {
  selectCanPlayPause,
  selectRunning,
} from "../../../../features/simulator/simulate/selectors";
import { toggleCurrentSimulator } from "../../../../features/simulator/simulate/slice";
import {
  useSimulatorDispatch,
  useSimulatorSelector,
} from "../../../../features/simulator/context";

export const PlayPauseCompute: FC = () => {
  const running = useSimulatorSelector(selectRunning);
  const canPlayPause = useSimulatorSelector(selectCanPlayPause);
  const simulatorDispatch = useSimulatorDispatch();

  return (
    <button
      onClick={() => {
        simulatorDispatch(toggleCurrentSimulator());
      }}
      disabled={!canPlayPause}
    >
      {running ? <IconPause /> : <IconRunFast />}
    </button>
  );
};
