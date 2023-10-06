import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconPencil: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconPencil"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M18.53 7.222a.75.75 0 010 1.06l-1.374 1.374-2.812-2.812 1.374-1.374a.75.75 0 011.06 0l1.752 1.752zM5.25 18.75v-2.812l8.299-8.3 2.812 2.813-8.299 8.3H5.25z"
    />
  </svg>
);
