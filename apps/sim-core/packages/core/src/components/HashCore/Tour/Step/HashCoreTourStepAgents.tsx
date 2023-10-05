import React, { FC } from "react";
import { useSelector } from "react-redux";

import {
  BackButton,
  Button,
  Buttons,
  Indicator,
  ProgressIndicator,
  useDomElementForFileId,
  useKeyboardSupport,
} from "./util";
import { selectCurrentFileId } from "../../../../features/files/selectors";

export const HashCoreTourStepAgents: FC = () => {
  const initialStateFile = useDomElementForFileId("initialState");
  const currentFileId = useSelector(selectCurrentFileId);
  const initialStateSelected = currentFileId === "initialState";

  useKeyboardSupport();

  return (
    <>
      <Indicator
        element={initialStateFile}
        show={!initialStateSelected}
        position="right"
      />
      <p>
        <a
          target="_blank"
          href="https://docs.hash.ai/core/creating-simulations/anatomy-of-an-agent"
        >
          HASH is oriented around agents.
        </a>{" "}
        You create agents that act and interact within your simulation.
      </p>
      <p>
        The `init` file, found in the 'src' folder on the left hand side, is
        where you define your initial agents.
      </p>
      <p>
        <strong>Open the `init` file to continue.</strong>
      </p>
      <Buttons>
        <BackButton />
        <Button type="next">Next</Button>
      </Buttons>
      <ProgressIndicator />
    </>
  );
};
