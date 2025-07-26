import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconDotsVertical: FC<IconProps> = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 18 18"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconDotsVertical"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M10.125 5.625a1.125 1.125 0 10-2.25 0 1.125 1.125 0 002.25 0zM9 7.875a1.125 1.125 0 110 2.25 1.125 1.125 0 010-2.25zm0 3.375a1.125 1.125 0 110 2.25 1.125 1.125 0 010-2.25z"
    />
  </svg>
);
