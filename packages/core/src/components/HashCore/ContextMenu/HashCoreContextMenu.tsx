import React, { FC, CSSProperties } from "react";

import "./HashCoreContextMenu.css";

interface HashCoreContextMenuProps {
  style: Pick<CSSProperties, "top" | "left">;
}

export const HashCoreContextMenu: FC<HashCoreContextMenuProps> = ({
  children,
  style,
}) => (
  <ul className="HashCoreContextMenu" style={style}>
    {children}
  </ul>
);
