import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconCancel: FC<IconProps> = ({ size = 15 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    className="Icon IconCancel"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M8 .5a7.5 7.5 0 110 15 7.5 7.5 0 010-15zM8 2a6 6 0 00-4.74 9.68l8.42-8.42A5.973 5.973 0 008 2zm6 6a6 6 0 01-9.68 4.74l8.42-8.42A5.974 5.974 0 0114 8z"
    />
  </svg>
);
