import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconEye: FC<IconProps> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="Icon IconEye">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M3.75 12C5.046 8.708 8.248 6.375 12 6.375S18.954 8.708 20.25 12c-1.296 3.292-4.498 5.625-8.25 5.625S5.046 15.292 3.75 12zM12 15.75a3.75 3.75 0 110-7.5 3.75 3.75 0 010 7.5zm0-6a2.25 2.25 0 100 4.5 2.25 2.25 0 000-4.5z"
    />
  </svg>
);
