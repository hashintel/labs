import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconImport: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconImport"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M17.25 6a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 01-1.5 1.5h-9c-.825 0-1.5-.675-1.5-1.5v-2.25h1.5v2.25h9v-9h-9v2.25h-1.5V7.5A1.5 1.5 0 018.25 6h9zm-6 3l3 3-3 3v-2.25h-6v-1.5h6V9z"
    />
  </svg>
);
