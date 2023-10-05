import React, { FC, ReactNode } from "react";

import "./ModalSplitLegacyTitle.scss";

export const ModalSplitLegacyTitle: FC<{
  title: ReactNode;
  description: ReactNode;
}> = ({ description, title }) => (
  <div className="ModalSplitLegacyTitle">
    <h2 className="ModalSplitLegacyTitle__Title">{title}</h2>
    <p className="ModalSplitLegacyTitle__Description">{description}</p>
  </div>
);
