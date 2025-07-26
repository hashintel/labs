import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconCodeTagsCheck: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconCodeTagsCheck"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M7.571 4.84L4.123 8.287l3.448 3.446 1.06-1.06-2.387-2.386L8.632 5.9l-1.06-1.06zm4.362 0l-1.06 1.06 2.388 2.387-2.388 2.386 1.06 1.06 3.449-3.446-3.449-3.447zm.82 12.205l6.067-6.068 1.057 1.058-7.125 7.125-3.81-3.817L10 14.285l2.752 2.76z"
    />
  </svg>
);
