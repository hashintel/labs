import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconInformationOutline: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconInformationOutline"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 4.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15zM6 12c0 3.308 2.692 6 6 6s6-2.692 6-6-2.692-6-6-6-6 2.692-6 6zm6.75-3.75v1.5h-1.5v-1.5h1.5zm0 3v4.5h-1.5v-4.5h1.5z"
    />
  </svg>
);
