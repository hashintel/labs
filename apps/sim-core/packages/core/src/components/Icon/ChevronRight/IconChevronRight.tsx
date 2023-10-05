import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconChevronRight: FC<IconProps> = ({ size = 23 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 23 23"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconChevronRight"
  >
    <path d="M8.836 14.796l3.296-3.296-3.296-3.296 1.016-1.017 4.312 4.313-4.312 4.313-1.016-1.017z" />
  </svg>
);
