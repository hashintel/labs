import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconDownload: FC<IconProps> = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconDownload"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M9.5 6.75h2L8 10.25l-3.5-3.5h2v-3h3v3zm2 4.5v1h-7v-1h7z"
    />
  </svg>
);
