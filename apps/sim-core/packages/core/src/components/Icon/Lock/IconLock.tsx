import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconLock: FC<IconProps> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="Icon IconLock">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M16.5 9.375a1.5 1.5 0 011.5 1.5v7.5a1.5 1.5 0 01-1.5 1.5h-9a1.5 1.5 0 01-1.5-1.5v-7.5a1.5 1.5 0 011.5-1.5h.75v-1.5a3.75 3.75 0 017.5 0v1.5h.75zm-4.5 6.75a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM9.75 7.876a2.25 2.25 0 114.5 0v1.5h-4.5v-1.5z"
    />
  </svg>
);
