import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconMenuDown: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconMenuDown"
  >
    <path d="M8.25 10.125l3.75 3.75 3.75-3.75h-7.5z" />
  </svg>
);
