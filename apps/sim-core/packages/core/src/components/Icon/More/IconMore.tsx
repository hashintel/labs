import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconMore: FC<IconProps> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 4" className="Icon IconMore">
    <path
      d="M2 0C.9 0 0 .9 0 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM8 0C6.9 0 6 .9 6 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"
      fillRule="nonzero"
    />
  </svg>
);
