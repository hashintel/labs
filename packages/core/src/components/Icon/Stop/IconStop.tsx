import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconStop: FC<IconProps> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="Icon IconStop">
    <path d="M16.5 16.5h-9v-9h9v9z" />
  </svg>
);
