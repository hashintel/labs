import React, { FC, useState } from "react";

import {
  BackButton,
  Button,
  Buttons,
  PlayIndicator,
  ProgressIndicator,
  useKeyboardSupport,
  useOnSimulationPlay,
} from "./util";

export const HashCoreTourStepPlay: FC = () => {
  const [played, setPlayed] = useState(false);

  useOnSimulationPlay(() => {
    setPlayed(true);
  }, [setPlayed]);

  useKeyboardSupport();

  return (
    <>
      <PlayIndicator show={!played} />
      <p>
        We've defined our agents, given them behaviors, and are ready to run the
        simulation.
      </p>
      <p>
        The viewer on the right shows you what's happening step-by-step within
        the simulation.
      </p>
      <p>
        <strong>Click the run button below the view pane to continue.</strong>{" "}
      </p>
      <Buttons>
        <BackButton />
        <Button type="next">Next</Button>
      </Buttons>
      <ProgressIndicator />
    </>
  );
};
