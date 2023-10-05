import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconUpdate: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconUpdate"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M13.665 10.59h5.085V5.25l-2.048 2.107a6.74 6.74 0 00-9.487 0c-2.633 2.603-2.61 6.833.015 9.436 2.632 2.61 6.907 2.61 9.54 0 1.32-1.305 1.98-3.233 1.98-4.718h-1.5c0 1.485-.51 2.663-1.53 3.668a5.265 5.265 0 01-7.41 0 5.156 5.156 0 010-7.343c2.047-2.025 5.362-1.95 7.41.075l-2.056 2.115zm-1.29 1.598V9h-1.126v3.75l3.21 1.905.54-.907-2.625-1.56z"
    />
  </svg>
);
