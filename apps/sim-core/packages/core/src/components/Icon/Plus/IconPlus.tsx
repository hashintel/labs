import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconPlus: FC<IconProps> = ({ size = 12 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 12 12"
    className="Icon IconPlus"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M11.25 6.75h-4.5v4.5h-1.5v-4.5H.75v-1.5h4.5V.75h1.5v4.5h4.5z" />
  </svg>
);
