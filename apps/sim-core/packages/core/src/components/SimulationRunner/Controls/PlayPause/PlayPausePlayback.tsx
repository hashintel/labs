import React, { FC } from "react";

import { IconPresentationPause, IconPresentationPlay } from "../../../Icon";
import {
  present,
  stopPresenting,
} from "../../../../features/simulator/simulate/slice";
import {
  selectCanPresent,
  selectPresenting,
} from "../../../../features/simulator/simulate/selectors";
import {
  useSimulatorDispatch,
  useSimulatorSelector,
} from "../../../../features/simulator/context";

export const PlayPausePlayback: FC = () => {
  const simulatorDispatch = useSimulatorDispatch();
  const presenting = useSimulatorSelector(selectPresenting);
  const canPresent = useSimulatorSelector(selectCanPresent);

  return (
    <button
      onClick={() => {
        if (presenting) {
          simulatorDispatch(stopPresenting());
        } else {
          simulatorDispatch(present());
        }
      }}
      disabled={!canPresent}
    >
      {presenting ? (
        <IconPresentationPause size={28} />
      ) : (
        <IconPresentationPlay size={28} />
      )}
    </button>
  );
};
