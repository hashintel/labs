import React, { FC } from "react";
import classNames from "classnames";

import "./SimulationRunId.scss";

const length = 6;

export const displayRunId = (id: string, cloud?: boolean) =>
  id.substr(cloud ? -length : 0, length).toUpperCase();

export const SimulationRunId: FC<{
  id: string;
  className?: string;
  end?: boolean;
}> = ({ id, className, end = false, children }) => {
  const displayId = displayRunId(id, end);

  return (
    <span className={classNames("SimulationRunId", className)}>
      {displayId}
      {children}
    </span>
  );
};
