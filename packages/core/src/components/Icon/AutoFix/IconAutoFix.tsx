import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconAutoFix: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconAutoFix"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M18.825 6l1.05-1.875L18 5.175l-1.875-1.05L17.175 6l-1.05 1.875L18 6.825l1.875 1.05L18.825 6zM9 6.825l-1.875 1.05L8.175 6l-1.05-1.875L9 5.175l1.875-1.05L9.825 6l1.05 1.875L9 6.825zm9 7.35l1.875-1.05L18.825 15l1.05 1.875L18 15.825l-1.875 1.05L17.175 15l-1.05-1.875L18 14.175zm-4.618-1.966l1.827-1.826-1.591-1.592-1.826 1.827 1.59 1.59zm2.523-2.362l-1.752-1.752a.75.75 0 00-1.06 0l-8.748 8.748a.75.75 0 000 1.06l1.752 1.753a.75.75 0 001.06 0l8.748-8.748a.749.749 0 000-1.061z"
    />
  </svg>
);
