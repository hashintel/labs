import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconSync: FC<IconProps> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="Icon IconSync">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 3.75V6c3.315 0 6 2.685 6 6a5.948 5.948 0 01-.93 3.195L15.975 14.1A4.403 4.403 0 0016.5 12c0-2.482-2.018-4.5-4.5-4.5v2.25l-3-3 3-3zM7.5 12c0 2.482 2.018 4.5 4.5 4.5v-2.25l3 3-3 3V18c-3.315 0-6-2.685-6-6 0-1.178.345-2.273.93-3.195L8.025 9.9A4.403 4.403 0 007.5 12z"
    />
  </svg>
);
