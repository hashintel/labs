import React, { FC, CSSProperties } from "react";

import "./SimulationRunContextMenu.scss";

interface SimulationRunContextMenuProps {
  style: Pick<CSSProperties, "top" | "right">;
}

export const SimulationRunContextMenu: FC<SimulationRunContextMenuProps> = ({
  children,
  style,
}) => (
  <ul className="SimulationRunContextMenu" style={style}>
    {children}
  </ul>
);
