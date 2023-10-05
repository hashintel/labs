import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconContentDuplicate: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconContentDuplicate"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M6.375 15.75h5.25v1.5l3-2.25-3-2.25v1.5h-5.25v-9h9v-1.5h-9c-.825 0-1.5.675-1.5 1.5v9c0 .825.675 1.5 1.5 1.5zm11.25-7.5v10.5h-8.25v-1.5h-1.5v1.5c0 .825.675 1.5 1.5 1.5h8.25c.825 0 1.5-.675 1.5-1.5V8.25c0-.825-.675-1.5-1.5-1.5h-8.25c-.825 0-1.5.675-1.5 1.5v4.5h1.5v-4.5h8.25z"
    />
  </svg>
);
