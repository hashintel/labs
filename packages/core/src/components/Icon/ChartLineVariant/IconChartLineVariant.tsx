import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconChartLineVariant: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconChartLineVariant"
  >
    <path d="M5.625 16.867l4.5-4.507 3 3L19.5 8.19l-1.058-1.058-5.317 5.978-3-3L4.5 15.742l1.125 1.125z" />
  </svg>
);
