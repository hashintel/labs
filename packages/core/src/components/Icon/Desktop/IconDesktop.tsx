import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconDesktop: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconDesktop"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M5.25 4.5h13.5a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 01-1.5 1.5H13.5l1.5 2.25v.75H9v-.75l1.5-2.25H5.25a1.5 1.5 0 01-1.5-1.5V6a1.5 1.5 0 011.5-1.5zm0 9h13.5V6H5.25v7.5z"
    />
  </svg>
);
