import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconTree: FC<IconProps> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="Icon IconTree">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M9.75 5.25h-4.5v3h4.5v-3zm9 5.25h-4.5v3h4.5v-3zm-4.5 5.25h4.5v3h-4.5v-3zm-6-3h4.5v-1.5h-4.5v-1.5h-1.5V18h6v-1.5h-4.5v-3.75z"
    />
  </svg>
);
