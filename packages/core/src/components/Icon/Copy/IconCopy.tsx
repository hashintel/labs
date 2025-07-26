import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconCopy: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconCopy"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M6.375 3.75h9v1.5h-9v10.5h-1.5V5.25c0-.825.675-1.5 1.5-1.5zm11.25 3h-8.25c-.825 0-1.5.675-1.5 1.5v10.5c0 .825.675 1.5 1.5 1.5h8.25c.825 0 1.5-.675 1.5-1.5V8.25c0-.825-.675-1.5-1.5-1.5zm0 12h-8.25V8.25h8.25v10.5z"
    />
  </svg>
);
