import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconKeyPlus: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconKeyPlus"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M7.875 4.875c1.47 0 2.72.94 3.183 2.25H19.5v2.25h-3v2.25h-2.25v-2.25h-3.192a3.376 3.376 0 11-3.183-4.5zm0 2.25a1.125 1.125 0 100 2.25 1.125 1.125 0 000-2.25zm3.375 8.25H9v1.5h2.25v2.25h1.5v-2.25H15v-1.5h-2.25v-2.25h-1.5v2.25z"
    />
  </svg>
);
