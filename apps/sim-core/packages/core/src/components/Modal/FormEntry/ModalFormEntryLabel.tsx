import React, { FC } from "react";

import "./ModalFormEntryLabel.scss";

export const ModalFormEntryLabel: FC<{ optional?: boolean }> = ({
  optional,
  children,
}) => (
  <div className="ModalFormEntry__Label">
    <strong>{children}</strong>{" "}
    {optional && <span className="ModalFormEntry__Optional">OPTIONAL</span>}
  </div>
);
