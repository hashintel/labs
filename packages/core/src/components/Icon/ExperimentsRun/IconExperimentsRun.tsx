import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconExperimentsRun: FC<IconProps> = ({ size = 26 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 26 25"
    className="Icon IconExperimentsRun"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M3.376 8.253V9.75h5.252V8.252H3.376zm1.502 2.998v1.498h3.75V11.25h-3.75zm1.497 4.501v-1.501h2.253v1.501H6.375zM10.25 7V5.5h7.5V7H17v10.5c0 1.65-1.35 3-3 3s-3-1.35-3-3V7h-.75zm2.25 8.25c0 .45.3.75.75.75s.75-.3.75-.75-.3-.75-.75-.75-.75.3-.75.75zM14.75 13c-.45 0-.75-.3-.75-.75s.3-.75.75-.75.75.3.75.75-.3.75-.75.75zM12.5 9.25h3V7h-3v2.25z"
    />
  </svg>
);
