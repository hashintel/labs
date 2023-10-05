import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconRunFast: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconRunFast"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M15.375 6.938a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm-2.7 10.425l.75-3.3 1.575 1.5v4.5h1.5v-5.625l-1.575-1.5.45-2.25a5.49 5.49 0 004.125 1.874v-1.5a3.69 3.69 0 01-3.225-1.8l-.75-1.2c-.27-.45-.75-.732-1.275-.75-.113 0-.206.02-.3.038-.094.019-.188.038-.3.038l-3.9 1.65v3.524h1.5v-2.55l1.35-.524-1.2 6.075-3.675-.75-.3 1.5 5.25 1.05zM5.25 8.813c0 .414.336.75.75.75h2.25v-1.5H6a.75.75 0 00-.75.75zm1.5-2.25a.75.75 0 110-1.5h3.75v1.5H6.75zm-2.25 5.25c0 .414.336.75.75.75h3v-1.5h-3a.75.75 0 00-.75.75z"
    />
  </svg>
);
