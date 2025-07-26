import React, { FC } from "react";

import { FancyAnchor } from "../../Fancy/Anchor";
import { FancyButton } from "../../Fancy/Button";
import { Modal } from "../Modal";
import { toggleProviderTarget } from "../../../features/simulator/simulate/thunks";
import { useSimulatorDispatch } from "../../../features/simulator/context";

import "./ModalCloudUsage.css";

export const ModalCloudUsage: FC<{ onCancel: VoidFunction }> = ({
  onCancel,
}) => {
  const simulatorDispatch = useSimulatorDispatch();

  return (
    <Modal modalClassName="ModalCloudUsage">
      <div className="ModalCloudUsage__Section">
        <h2>You've reached your cloud compute limit</h2>
        <p>
          As a free user, you get <strong>10 hours</strong> of cloud compute
          credit <strong>each month</strong>
        </p>
      </div>
      <div className="ModalCloudUsage__Section">
        <h3>Upgrade to HASH Pro for unlimited cloud simulation runs</h3>
        <div className="ModalCloudUsage__Buttons">
          <FancyButton
            className="ModalCloudUsage__Buttons__Simulate"
            icon="runFast"
            onClick={(evt) => {
              evt.preventDefault();
              simulatorDispatch(toggleProviderTarget("web"));
              onCancel();
            }}
          >
            Simulate Locally
          </FancyButton>
          <FancyAnchor
            icon="hCoreMono"
            path="http://hash.ai/contact"
            target="_blank"
            className="ModalCloudUsage__Buttons__Contact"
          >
            Contact us about Pro
          </FancyAnchor>
        </div>
      </div>
    </Modal>
  );
};
