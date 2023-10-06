import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconChartBarStacked: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconChartBarStacked"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M4.5 5.25v13.5h15v-3h-3v1.5H15V15h-3v2.25h-1.5v-1.5h-3v1.5H6v-12H4.5zm15 8.25h-3V15h3v-1.5zm-7.5-6h3v2.25h-3V7.5zm0 6.75h3V10.5h-3v3.75zM7.5 10.5h3V12h-3v-1.5zm0 4.5h3v-2.25h-3V15z"
    />
  </svg>
);
