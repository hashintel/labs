import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconPresentationPlay: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconPresentationPlay"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M4.5 5.625h6a1.5 1.5 0 113 0h6v1.5h-.75v8.25h-4.313l1.313 4.5h-1.5l-1.313-4.5h-1.874l-1.313 4.5h-1.5l1.313-4.5H5.25v-8.25H4.5v-1.5zm2.25 1.5v6.75h10.5v-6.75H6.75zm4.732 5.222c.14.058.3.026.408-.082l1.047-1.047c.24-.24.48-.479.48-.718 0-.24-.24-.478-.48-.718L11.89 8.735a.375.375 0 00-.64.265v3c0 .152.091.289.232.347z"
    />
  </svg>
);
