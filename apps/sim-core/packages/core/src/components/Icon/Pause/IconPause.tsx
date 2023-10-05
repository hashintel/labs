import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconPause: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconPause"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M10.5 17.25h-3V6.75h3v10.5zm6 0h-3V6.75h3v10.5z"
    />
  </svg>
);
