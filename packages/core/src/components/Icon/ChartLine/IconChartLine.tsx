import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconChartLine: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconChartLine"
  >
    <path d="M15.005 11.833l3.175-5.499 1.3.75-3.926 6.798-4.884-2.82-3.572 6.188H19.5v1.5h-15V5.25H6v10.902l4.121-7.139 4.884 2.82z" />
  </svg>
);
