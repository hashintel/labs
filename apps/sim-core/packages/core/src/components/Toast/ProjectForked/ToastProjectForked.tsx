import React, { FC } from "react";

import { IconCheck } from "../../Icon";
import { SimulationProject } from "../../../features/project/types";
import { SimulationToast } from "../";

export const ToastProjectForked: FC<{ project: SimulationProject }> = ({
  project,
}) => (
  <SimulationToast theme="success" isDismissable>
    <span style={{ marginRight: 10, marginTop: 2 }}>
      <IconCheck size={13} />
    </span>
    <span>
      You have successfully created a fork of{" "}
      <strong>{project.name.trim()}</strong>. You can now edit below.
    </span>
  </SimulationToast>
);
