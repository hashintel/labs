import { Marking } from "./one-step/marking";

import "./one-step.css";

/**
 * One step of the cycle from A 1, B 0: Go fires and Back waits, so the step
 * ends at A 0, B 1. Static, since the step is one update and not a motion.
 */
export const OneStep: React.FC = () => {
  return (
    <div className="one-step" aria-hidden="true">
      <Marking
        label="step k"
        places={[
          { name: "A", tokens: 1 },
          { name: "B", tokens: 0 },
        ]}
      />
      <div className="one-step__firing">
        <span className="one-step__fires">Go fires</span>
        <span className="one-step__arrow" />
        <span className="one-step__waits">Back waits</span>
      </div>
      <Marking
        label="step k + 1"
        places={[
          { name: "A", tokens: 0 },
          { name: "B", tokens: 1 },
        ]}
      />
    </div>
  );
};
