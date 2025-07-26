import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconCheckboxMarkedOutline: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconCheckboxMarkedOutline"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M6.75 17.25h10.5v-6h1.5v6a1.5 1.5 0 01-1.5 1.5H6.75a1.5 1.5 0 01-1.5-1.5V6.75a1.5 1.5 0 011.5-1.5h7.5v1.5h-7.5v10.5zm1.125-5.625l1.06-1.06 2.315 2.314 6.44-6.44L18.75 7.5l-7.5 7.5-3.375-3.375z"
    />
  </svg>
);
