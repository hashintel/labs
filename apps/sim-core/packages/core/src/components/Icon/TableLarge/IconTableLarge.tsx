import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconTableLarge: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconTableLarge"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M18 4.875H6a1.5 1.5 0 00-1.5 1.5v11.25a1.5 1.5 0 001.5 1.5h12a1.5 1.5 0 001.5-1.5V6.375a1.5 1.5 0 00-1.5-1.5zm-12 5.25v-2.25h3v2.25H6zm4.5-2.25v2.25h3v-2.25h-3zm7.5 0v2.25h-3v-2.25h3zm-12 3.75v2.25h3v-2.25H6zm3 6H6v-2.25h3v2.25zm1.5-6v2.25h3v-2.25h-3zm3 6h-3v-2.25h3v2.25zm4.5 0v-2.25h-3v2.25h3zm-3-6h3v2.25h-3v-2.25z"
    />
  </svg>
);
