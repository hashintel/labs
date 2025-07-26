import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconAlert: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconAlert"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 4.875l8.25 14.25H3.75L12 4.875zm.75 9h-1.5v-3h1.5v3zm0 1.5v1.5h-1.5v-1.5h1.5z"
    />
  </svg>
);
