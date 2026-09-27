import React, { FC, PropsWithChildren, CSSProperties } from "react";

import "./HashCoreContextMenu.css";

type HashCoreContextMenuProps = {
  style: Pick<CSSProperties, "top" | "left">;
};

export const HashCoreContextMenu: FC<
  PropsWithChildren<HashCoreContextMenuProps>
> = ({ children, style }) => (
  <ul className="HashCoreContextMenu" style={style}>
    {children}
  </ul>
);
