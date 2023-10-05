import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconClose: FC<IconProps> = ({ size = 12 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 12 12"
    className="Icon IconClose"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M11.25 1.808L10.192.75 6 4.943 1.808.75.75 1.808 4.943 6 .75 10.192l1.058 1.058L6 7.057l4.192 4.193 1.058-1.058L7.057 6z" />
  </svg>
);
