import React, { FC, useEffect, useMemo, useReducer } from "react";
import { useSelector } from "react-redux";

import {
  BackButton,
  Button,
  Buttons,
  Indicator,
  PlayIndicator,
  ProgressIndicator,
  useDomElementForFileId,
  useKeyboardSupport,
  useOnSimulationPlay,
  useOnSimulationReset,
} from "./util";
import { globalsFileId } from "../../../../features/files/utils";
import { selectCurrentFileId } from "../../../../features/files/selectors";

const refreshInitialState = {
  hasOpenedProperties: false,
  hasReset: false,
  hasPlayed: false,
};

enum RefreshAction {
  OPEN_PROPERTIES = "OPEN_PROPERTIES",
  PLAYED = "SIMULATION_PLAYED",
  RESET = "SIMULATION_RESET",
}

function refreshReducer(
  state: typeof refreshInitialState,
  action: RefreshAction,
) {
  switch (action) {
    case RefreshAction.OPEN_PROPERTIES:
      return { ...state, hasOpenedProperties: true };

    case RefreshAction.RESET:
      return { ...state, hasReset: state.hasOpenedProperties };

    case RefreshAction.PLAYED:
      return { ...state, hasPlayed: state.hasReset };
  }
}

export const HashCoreTourStepRefresh: FC = () => {
  const [state, dispatch] = useReducer(refreshReducer, refreshInitialState);
  const propertiesFile = useDomElementForFileId(globalsFileId);
  const currentFileId = useSelector(selectCurrentFileId);

  useKeyboardSupport();

  useOnSimulationReset(() => {
    dispatch(RefreshAction.RESET);
  }, []);

  useOnSimulationPlay(() => {
    dispatch(RefreshAction.PLAYED);
  }, []);

  useEffect(() => {
    if (currentFileId === globalsFileId) {
      dispatch(RefreshAction.OPEN_PROPERTIES);
    }
  }, [currentFileId]);

  const resetButton = useMemo(
    () => document.querySelector<HTMLElement>(".reset.simulation-control"),
    [],
  );

  return (
    <>
      <Indicator
        element={propertiesFile}
        show={!state.hasOpenedProperties}
        position="right"
      />
      <Indicator
        element={resetButton}
        show={state.hasOpenedProperties && !state.hasReset}
        position="left-overlap"
      />
      <PlayIndicator show={state.hasReset && !state.hasPlayed} />
      <p>
        <a
          href="https://docs.hash.ai/core/creating-simulations/configuration/basic-properties"
          target="_blank"
          rel="noreferrer"
        >
          globals.json is where you define global properties
        </a>{" "}
        within your simulated world.
      </p>
      <p>
        These properties are accessible to all agents through '
        <a
          href="https://docs.hash.ai/core/creating-simulations/anatomy-of-an-agent/context"
          target="_blank"
          rel="noreferrer"
        >
          context
        </a>
        '.
      </p>
      <p>
        <strong>
          Change a property, then click the 'reset' and 'run' buttons to see
          what happens.
        </strong>
      </p>
      <Buttons>
        <BackButton />
        <Button type="next">Next</Button>
      </Buttons>
      <ProgressIndicator />
    </>
  );
};
