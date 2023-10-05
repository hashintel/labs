import React, { FC, useState } from "react";
import classNames from "classnames";

import { PlayPauseCompute } from "./PlayPauseCompute";
import { PlayPausePlayback } from "./PlayPausePlayback";
import { PlayPauseTooltip } from "./PlayPauseTooltip";
import {
  selectCanCurrentSimCompute,
  selectHasCurrentSimulation,
} from "../../../../features/simulator/simulate/selectors";
import { useSimulatorSelector } from "../../../../features/simulator/context";

export const PlayPause: FC = () => {
  const canCompute = useSimulatorSelector(selectCanCurrentSimCompute);
  const hasSimulation = useSimulatorSelector(selectHasCurrentSimulation);
  const [open, setOpen] = useState(false);

  return (
    <div
      className={classNames("simulate simulation-control", {
        "simulation-control--open": open,
      })}
    >
      {canCompute ? <PlayPauseCompute /> : <PlayPausePlayback />}
      {hasSimulation ? <PlayPauseTooltip onOpenChange={setOpen} /> : null}
    </div>
  );
};
