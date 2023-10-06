import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconFilePlus: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconFilePlus"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M7.5 4.5h6L18 9v9a1.5 1.5 0 01-1.5 1.5H7.492A1.494 1.494 0 016 18l.008-12c0-.828.663-1.5 1.492-1.5zm5.25 5.25h4.125L12.75 5.625V9.75zm-1.5 2.252v2.25h2.25v1.5h-2.25v2.25h-1.5v-2.25H7.5v-1.5h2.25v-2.25h1.5z"
    />
  </svg>
);
