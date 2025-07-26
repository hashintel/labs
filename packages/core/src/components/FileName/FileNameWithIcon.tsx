import React, { FC } from "react";

import { FileName } from "./FileName";
import { IconFileOutline } from "../Icon/FileOutline";
import { IconFolder } from "../Icon/Folder";
import { IconFolderOpen } from "../Icon/FolderOpen";

import "./FileNameWithIcon.scss";

type IconType = "file" | "closedFolder" | "openFolder";

function getIcon(icon: IconType) {
  switch (icon) {
    case "file":
      return <IconFileOutline />;

    case "closedFolder":
      return <IconFolder />;

    case "openFolder":
      return <IconFolderOpen />;
  }
}

export const FileNameWithIcon: FC<{
  icon: IconType;
}> = ({ icon, children }) => (
  <FileName className="FileNameWithIcon">
    {getIcon(icon)}
    <div className="FileNameWithIcon__FileName">{children}</div>
  </FileName>
);
