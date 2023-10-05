import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconFolderLock: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconFolderLock"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M18 7.5A1.5 1.5 0 0119.5 9v7.5A1.5 1.5 0 0118 18H6a1.5 1.5 0 01-1.5-1.5l.008-9C4.508 6.672 5.17 6 6 6h4.5L12 7.5h6zm-.75 8.251v-3h-.75v-.75a2.25 2.25 0 00-4.5 0v.75h-.75v3h6zM15 12.001a.75.75 0 00-1.5 0v.75H15v-.75z"
    />
  </svg>
);
