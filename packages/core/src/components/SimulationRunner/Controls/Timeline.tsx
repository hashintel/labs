import React, { forwardRef, useState } from "react";

import {
  selectCurrentRunnerHasSteps,
  selectCurrentRunnerMinStep,
  selectCurrentRunnerNumSteps,
  selectCurrentStep,
} from "../../../features/simulator/simulate/selectors";
import { setScrubbedStep } from "../../../features/simulator/simulate/slice";
import {
  useSimulatorDispatch,
  useSimulatorSelector,
} from "../../../features/simulator/context";

export const Timeline = forwardRef<HTMLDivElement>((_, ref) => {
  const currentStep = useSimulatorSelector(selectCurrentStep);
  const minAvailableStep = useSimulatorSelector(selectCurrentRunnerMinStep);
  const hasSteps = useSimulatorSelector(selectCurrentRunnerHasSteps);
  const numSteps = useSimulatorSelector(selectCurrentRunnerNumSteps);
  const dispatch = useSimulatorDispatch();
  const [mouseDown, setMouseDown] = useState(false);

  return (
    <div
      ref={ref}
      className="scrubber"
      onMouseDown={() => setMouseDown(true)}
      onMouseUp={() => setMouseDown(false)}
    >
      {hasSteps ? (
        <div className="current-container">
          <output
            className="step current"
            key="current"
            htmlFor="timeline"
            style={{
              left: `${(currentStep / numSteps) * 100}%`,
              display: mouseDown ? "block" : "none",
            }}
          >
            {currentStep}
          </output>
        </div>
      ) : null}
      <div className="scrubber-input">
        <input
          type="range"
          name="timeline"
          min={minAvailableStep}
          value={currentStep}
          onChange={(evt) => {
            const newStep = parseInt(evt.currentTarget.value);
            dispatch(setScrubbedStep(newStep));
          }}
          max={numSteps ?? 0}
          style={{ flex: 1 }}
          disabled={!hasSteps}
        />
      </div>

      <div className={hasSteps ? "timeline hidden" : "timeline"}>
        <span className="step">{minAvailableStep}</span>
        <span className="step last">
          {hasSteps
            ? currentStep >= numSteps
              ? numSteps
              : `${currentStep}/${numSteps}`
            : null}
        </span>
      </div>
    </div>
  );
});
