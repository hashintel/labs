import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconFolderOpen: FC<IconProps> = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox={`0 0 ${size} ${size}`}
    className="Icon IconFolderOpen"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M12.5959 13.5H4.15839C3.53682 13.5 3.03339 12.996 3.03339 12.375L3.03901 5.625C3.03901 5.004 3.53682 4.5 4.15839 4.5H7.53339L8.65839 5.625H12.5959C13.2169 5.625 13.7209 6.129 13.7209 6.75V6.75107L4.15839 6.74994V12.3749L5.3645 7.87607H14.9666L13.6828 12.6672C13.5537 13.1467 13.1157 13.5 12.5958 13.5H12.5959Z" />
  </svg>
);
