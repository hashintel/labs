import React, { FC } from "react";
import { ReactSVG } from "react-svg";
import classNames from "classnames";

import "./Logo.css";

interface LogoProps {
  size?: number;
  logoSize?: number;
  textSize?: number;
  className?: string;
}

export const Logo: FC<LogoProps> = ({
  size = 1,
  logoSize = size,
  textSize = size,
  className,
  children,
}) => (
  <div className={classNames("logo", className)}>
    <div
      style={{
        width: `${logoSize}rem`,
        height: `${logoSize}rem`,
      }}
      className="hash-logo"
    >
      <div className="vertical1" />
      <div className="vertical2" />
      <div className="horizontal1" />
      <div className="horizontal2" />
    </div>
    <div
      className="LogoText"
      style={{
        marginLeft: `${textSize * 0.5}rem`,
      }}
    >
      <ReactSVG
        src="https://cdn-us1.hash.ai/assets/hash-white-letters.svg"
        className="hash-letters"
        style={{
          height: `${textSize}rem`,
        }}
      />
      {children}
    </div>
  </div>
);
