import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconCheckboxMarkedCircleOutline: FC<IconProps> = ({
  size = 24,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconCheckboxMarkedCircleOutline"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 18a6 6 0 006-6h1.5a7.5 7.5 0 11-4.67-6.944l-1.18 1.18A5.997 5.997 0 0012 6a6 6 0 000 12zm-4.125-6.375l1.06-1.06 2.315 2.314 6.44-6.44L18.75 7.5l-7.5 7.5-3.375-3.375z"
    />
  </svg>
);
