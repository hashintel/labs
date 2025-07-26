import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconAlertOutline: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconAlertOutline"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M3.751 19.125l8.251-14.25 8.247 14.25H3.75zm13.898-1.502l-5.647-9.748-5.65 9.748h11.297zm-6.398-6.75v3h1.498v-3H11.25zm0 5.999v-1.498h1.498v1.498H11.25z"
    />
  </svg>
);
