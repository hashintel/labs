import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconArrowLeftBold: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconArrowLeftBold"
  >
    <path d="M17.94 9.75v4.5h-6v3.629l-5.88-5.88 5.88-5.878V9.75h6z" />
  </svg>
);
