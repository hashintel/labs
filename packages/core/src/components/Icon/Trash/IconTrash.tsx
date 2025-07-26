import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconTrash: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconTrash"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M6.75 7.5zm0 0h10.5V6h-2.625l-.75-.75h-3.75l-.75.75H6.75v1.5zm.75 9.75a1.5 1.5 0 001.5 1.5h6a1.5 1.5 0 001.5-1.5v-9h-9v9z"
    />
  </svg>
);
