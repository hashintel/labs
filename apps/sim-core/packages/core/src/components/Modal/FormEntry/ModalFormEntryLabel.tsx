import React, { FC, PropsWithChildren } from "react";

import "./ModalFormEntryLabel.scss";

export const ModalFormEntryLabel: FC<PropsWithChildren<{ optional?: boolean }>> = ({
  optional,
  children,
}) => (
  <div className="ModalFormEntry__Label">
    <strong>{children}</strong>{" "}
    {optional && <span className="ModalFormEntry__Optional">OPTIONAL</span>}
  </div>
);
