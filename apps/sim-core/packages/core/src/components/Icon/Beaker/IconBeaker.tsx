import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconBeaker: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconBeaker"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M18.75 5.25H5.25v1.5a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 001.5 1.5h7.5a1.5 1.5 0 001.5-1.5v-9a1.5 1.5 0 011.5-1.5v-1.5zm-10.5 3v-1.5h7.5v10.5h-7.5V15h2.25v-.75H8.25v-.75H12v-.75H8.25V12h2.25v-.75H8.25v-.75h2.25v-.75H8.25V9H12v-.75H8.25z"
    />
  </svg>
);
