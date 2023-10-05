import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconOpenInNew: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconOpenInNew"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M6.75 6.75v10.5h10.5V12h1.5v5.25c0 .825-.675 1.5-1.5 1.5H6.75a1.5 1.5 0 01-1.5-1.5V6.75a1.5 1.5 0 011.5-1.5H12v1.5H6.75zm6.75 0v-1.5h5.25v5.25h-1.5V7.808L9.877 15.18 8.82 14.123l7.372-7.373H13.5z"
    />
  </svg>
);
