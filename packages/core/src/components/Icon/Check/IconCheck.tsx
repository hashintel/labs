import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconCheck: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconCheck"
  >
    <path d="M18.563 8.03l-9 9-4.126-4.125 1.061-1.06 3.064 3.064 7.94-7.94 1.06 1.061z" />
  </svg>
);
