import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconPresentationPause: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconPresentationPause"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M10.5 5.625h-6v1.5h.75v8.25h4.313l-1.313 4.5h1.5l1.313-4.5h1.874l1.313 4.5h1.5l-1.313-4.5h4.313v-8.25h.75v-1.5h-6a1.5 1.5 0 10-3 0zm-3.75 8.25v-6.75h10.5v6.75H6.75zM12.3 8.88a.25.25 0 01.25-.25h.5a.25.25 0 01.25.25v3.25a.25.25 0 01-.25.25h-.5a.25.25 0 01-.25-.25V8.88zm-1.25-.25a.25.25 0 00-.25.25v3.25c0 .138.112.25.25.25h.5a.25.25 0 00.25-.25V8.88a.25.25 0 00-.25-.25h-.5z"
    />
  </svg>
);
