import React from "react";
import { useSelector } from "react-redux";

import { IconOpenInNew } from "../Icon/OpenInNew";
import { Logo } from "../Logo";
import { selectCurrentProjectUrl } from "../../features/project/selectors";

import "./OpenInCore.scss";

export const OpenInCore = () => {
  const projectUrl = useSelector(selectCurrentProjectUrl);

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
