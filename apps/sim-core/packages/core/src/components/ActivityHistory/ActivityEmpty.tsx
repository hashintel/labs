import React, { FC, PropsWithChildren } from "react";

import "./ActivityEmpty.scss";

export const ActivityEmpty: FC<PropsWithChildren> = ({ children }) => (
  <div className="ActivityEmpty">{children}</div>
);
