import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconKeyboardReturn: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconKeyboardReturn"
  >
    <path d="M17.625 8.25v3H7.746l2.69-2.69L9.374 7.5l-4.5 4.5 4.5 4.5 1.06-1.06-2.689-2.69h11.379v-4.5h-1.5z" />
  </svg>
);
