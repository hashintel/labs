import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconArrowRightBold: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconArrowRightBold"
  >
    <path d="M6.06 14.25v-4.5h6V6.12L17.94 12l-5.88 5.88v-3.63h-6z" />
  </svg>
);
