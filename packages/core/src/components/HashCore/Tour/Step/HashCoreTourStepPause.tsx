import React, { FC } from "react";

import {
  BackButton,
  Button,
  Buttons,
  ProgressIndicator,
  useKeyboardSupport,
  useSimulationPause,
} from "./util";

export const HashCoreTourStepPause: FC = () => {
  useKeyboardSupport();
  useSimulationPause();

  return (
    <>
      <p>Congratulations, you just ran a simulation!</p>
      <p>
        Small changes to parameters can have a huge impact on simulation
        outcomes. Parameter values are set in the globals.json file.
      </p>
      <p>
        <em>
          We've paused your simulation for you, but normally this will keep
          running until stopped.
        </em>
      </p>
      <Buttons>
        <BackButton />
        <Button type="next">Next</Button>
      </Buttons>
      <ProgressIndicator />
    </>
  );
};
