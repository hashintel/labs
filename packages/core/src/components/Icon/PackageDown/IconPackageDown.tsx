import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconPackageDown: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconPackageDown"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M17.363 5.662l1.042 1.26c.218.256.345.593.345.953v9.375c0 .825-.675 1.5-1.5 1.5H6.75c-.825 0-1.5-.675-1.5-1.5V7.875c0-.36.128-.697.345-.952l1.035-1.26c.21-.256.518-.413.87-.413h9c.352 0 .66.157.863.412zM6.84 6.75L7.447 6h9l.706.75H6.84zM12 16.125L7.875 12H10.5v-1.5h3V12h2.625L12 16.125z"
    />
  </svg>
);
