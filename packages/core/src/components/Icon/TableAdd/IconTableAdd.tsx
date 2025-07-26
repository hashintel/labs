import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconTableAdd: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconTableAdd"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M16.55 4.876H6.05a1.5 1.5 0 00-1.5 1.5v9a1.5 1.5 0 001.5 1.5h4.63l1.37-1.371v-3.129h3.13l2.87-2.871V6.376a1.5 1.5 0 00-1.5-1.5zm-10.5 6v-3h4.5v3h-4.5zm6-3v3h4.5v-3h-4.5zm-6 7.5v-3h4.5v3h-4.5z"
    />
    <path d="M13.496 15.222h5.228v1.772h-5.228v-1.772z" />
    <path d="M15.224 18.722v-5.228h1.772v5.228h-1.772z" />
  </svg>
);
