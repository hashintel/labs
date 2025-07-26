import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconContentCopy: FC<IconProps> = ({ size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconContentCopy"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M5.313 3.125h7.5v1.25h-7.5v8.75h-1.25v-8.75c0-.688.562-1.25 1.25-1.25zm9.375 2.5H7.811c-.687 0-1.25.563-1.25 1.25v8.75c0 .688.563 1.25 1.25 1.25h6.875c.688 0 1.25-.563 1.25-1.25v-8.75c0-.688-.562-1.25-1.25-1.25zm0 10H7.811v-8.75h6.875v8.75z"
    />
  </svg>
);
