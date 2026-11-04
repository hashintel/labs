import React from "react";

import { IconOpenInNew } from "../Icon/OpenInNew";
import { Logo } from "../Logo";
import { useProject } from "../../features/project/ProjectContext";

import "./OpenInCore.scss";

export const OpenInCore = () => {
  const { currentProjectUrl: projectUrl } = useProject();

  return (
    <a
      className="OpenInCore"
      href={`${window.location.origin}${projectUrl}`}
      target="_blank"
    >
      <Logo logoSize={2.0921875} textSize={1.23}>
        <h4 className="OpenInCore__Text">
          Open simulation <IconOpenInNew size={12} />
        </h4>
      </Logo>
    </a>
  );
};
