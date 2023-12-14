import React from "react";

import "./LoadingIcon.css";

interface LoadingIconProps {
  fullScreen?: boolean;
}

export const LoadingIcon: React.FC<LoadingIconProps> = ({ fullScreen }) => (
  <div className={"loading-icon" + (fullScreen ? " full-screen" : "")}>
    <div className="hash-logo">
      <div className="vertical1" />
      <div className="vertical2" />
      <div className="horizontal1" />
      <div className="horizontal2" />
    </div>
  </div>
);
