import React, { FC } from "react";

import { HcSharedBehaviorFile } from "../../../features/files/types";
import { SimulationToast } from "../SimulationToast";

export const ToastReleaseBehaviorSuccess: FC<{
  files: HcSharedBehaviorFile[];
}> = ({ files }) => (
  <SimulationToast theme="success">
    <span>
      You have successfully released{" "}
      <strong>{files[0].pathWithNamespace}</strong>.
    </span>
  </SimulationToast>
);
