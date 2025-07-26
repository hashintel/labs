import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconCubeUnfolded: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconCubeUnfolded"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M7.5 9.375v-3.75h5.25v3.75h7.5v5.25H16.5v3.75h-5.25v-3.75h-7.5v-5.25H7.5zm7.5 5.25h-2.25v2.25H15v-2.25zm-3.75-5.25H9v-2.25h2.25v2.25zm-3.75 3.75v-2.25H5.25v2.25H7.5zm9 0v-2.25h2.25v2.25H16.5zm-3.75-2.25v2.25H15v-2.25h-2.25zM9 13.125v-2.25h2.25v2.25H9z"
    />
  </svg>
);
