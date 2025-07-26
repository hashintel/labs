import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconFolder: FC<IconProps> = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox={`0 0 ${size} ${size}`}
    className="Icon IconFolder"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M9 5.625h4.5c.621 0 1.125.504 1.125 1.125v5.625c0 .621-.504 1.125-1.125 1.125h-9a1.125 1.125 0 01-1.125-1.125l.006-6.75A1.12 1.12 0 014.5 4.5h3.375L9 5.625zM4.5 6.75v5.625h9V6.75h-9z"
    />
  </svg>
);
