import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconDragVertical: FC<IconProps> = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 18 18"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconDragVertical"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M8.438 3.938H7.312v1.124h1.125V3.938zm2.25 0H9.562v1.124h1.126V3.938zm-3.376 2.25h1.125v1.125H7.313V6.188zm3.375 0H9.563v1.125h1.124V6.188zm-3.374 2.25h1.125v1.124H7.312V8.438zm3.375 0H9.562v1.124h1.126V8.438zm-3.376 2.25h1.125v1.124H7.313v-1.124zm3.375 0H9.563v1.124h1.124v-1.124zm-3.374 2.25h1.125v1.124H7.312v-1.124zm3.375 0H9.562v1.124h1.126v-1.124z"
      opacity={1}
    />
  </svg>
);
