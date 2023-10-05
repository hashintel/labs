import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconEyeOutline: FC<IconProps> = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconEyeOutline"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M8 4.25A5.912 5.912 0 0113.5 8 5.912 5.912 0 018 11.75 5.912 5.912 0 012.5 8 5.912 5.912 0 018 4.25zM8 6.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 4.25A4.908 4.908 0 013.591 8a4.908 4.908 0 018.817 0A4.909 4.909 0 018 10.75z"
      fillOpacity={0.5}
    />
  </svg>
);
