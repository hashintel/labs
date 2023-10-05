import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconServer: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconServer"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M18 4.5H6a.75.75 0 00-.75.75v3c0 .414.336.75.75.75h12a.75.75 0 00.75-.75v-3A.75.75 0 0018 4.5zm-4.5 12h-.75V15H18a.75.75 0 00.75-.75v-3a.75.75 0 00-.75-.75H6a.75.75 0 00-.75.75v3c0 .414.336.75.75.75h5.25v1.5h-.75a.75.75 0 00-.75.75H4.5v1.5h5.25c0 .414.336.75.75.75h3a.75.75 0 00.75-.75h5.25v-1.5h-5.25a.75.75 0 00-.75-.75zm-3.75-9h.75V6h-.75v1.5zm.75 6h-.75V12h.75v1.5zM6.75 6v1.5h1.5V6h-1.5zm0 7.5V12h1.5v1.5h-1.5z"
    />
  </svg>
);
