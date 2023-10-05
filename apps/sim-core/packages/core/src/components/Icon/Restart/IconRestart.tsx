import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconRestart: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconRestart"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M16.24 9a5.968 5.968 0 00-4.242-1.75V4.759L8.286 8.47l3.712 3.713V8.768a4.436 4.436 0 013.182 1.294 4.503 4.503 0 010 6.364 4.492 4.492 0 01-3.6 1.297l-.393 1.465a5.992 5.992 0 005.048-1.707A5.992 5.992 0 0016.241 9zm-9.402 1.205a5.987 5.987 0 00.917 7.281 5.975 5.975 0 001.983 1.317l.392-1.465a4.493 4.493 0 01-2.19-6.03l-1.102-1.103z"
    />
  </svg>
);
