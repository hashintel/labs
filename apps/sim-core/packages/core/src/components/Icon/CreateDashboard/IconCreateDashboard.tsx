import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconCreateDashboard: FC<IconProps> = ({ size = 25 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 25 22"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconCreateDashboard"
  >
    <path d="M21.625 6.375h-2.25v2.25h-.75v-2.25h-2.25v-.75h2.25v-2.25h.75v2.25h2.25v.75z" />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M9.563 11.313V7.937h4.5v3.375h-4.5zm4.5 6.75h-4.5v-5.625h4.5v5.624zm-10.126 0h4.5v-3.375h-4.5v3.374zm4.5-4.5h-4.5V7.936h4.5v5.625z"
    />
  </svg>
);
