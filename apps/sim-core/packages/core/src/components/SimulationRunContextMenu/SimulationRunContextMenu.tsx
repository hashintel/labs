import React, { FC, PropsWithChildren, CSSProperties } from "react";

import "./SimulationRunContextMenu.scss";

type SimulationRunContextMenuProps = {
  style: Pick<CSSProperties, "top" | "right">;
};

export const SimulationRunContextMenu: FC<
  PropsWithChildren<SimulationRunContextMenuProps>
> = ({ children, style }) => (
  <ul className="SimulationRunContextMenu" style={style}>
    {children}
  </ul>
);
